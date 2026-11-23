#!/usr/bin/env python3
"""Greenbox MCP server (stdio). Lets Claude (Desktop / Code / Cowork), Codex, or any MCP client drive Greenbox:
look at the 3D view, open tabs, analyse / auto-rig a model, edit vehicles, build play-test maps, set up the HP-bar
video, export files to disk, load files from disk.

Works with BOTH ways of opening Greenbox:
  * local (Mo-Greenbox / serve.py): talks to serve.py's bridge (gb-ai/.bridge.json), as before;
  * the web version (GitHub Pages or any host): this script opens a small relay on 127.0.0.1 and the Greenbox tab
    connects to it after you type the pairing code once (🤖 AI → ⚙ → Claude / Codex → code). Nothing leaves
    your computer: the browser talks to 127.0.0.1 only, and only a tab that knows the code gets the jobs.

Setup — pick your app (use the full path of this file):
  Claude Desktop  Settings → Developer → Edit config:
                  {"mcpServers": {"greenbox": {"command": "python3", "args": ["/PATH/greenbox_mcp.py"]}}}
  Claude Code     claude mcp add greenbox -- python3 /PATH/greenbox_mcp.py
  Codex CLI       ~/.codex/config.toml:
                  [mcp_servers.greenbox]
                  command = "python3"
                  args = ["/PATH/greenbox_mcp.py"]
Then ask the AI: "connect to Greenbox" — it calls gb_connect and tells you the code to type in Greenbox.

Standard library only (Python 3.8+). The tool list comes from tools.json (generated from tools.js), so the
in-app AI chat and this server always offer the same actions.
"""
import base64
import mimetypes
import re
import shutil
import subprocess
import tempfile
import http.server
import json
import os
import queue
import secrets
import socketserver
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
PROTOCOL = '2024-11-05'
HOME = os.path.join(os.path.expanduser('~'), '.greenbox')
RELAY_FILE = os.path.join(HOME, 'relay.json')
BASE_PORT = int(os.environ.get('GREENBOX_MCP_PORT', '47827'))
EXTRA_ORIGINS = [o.strip() for o in os.environ.get('GREENBOX_ORIGINS', '').split(',') if o.strip()]

# tools that only exist on this side (they do not run in the browser)
LOCAL_TOOLS = [{
    'name': 'gb_connect',
    'description': 'Connect this AI to Greenbox (needed once for the web version). Returns the pairing code and what the user must do in Greenbox. Call it first when another tool says Greenbox is not connected.',
    'inputSchema': {'type': 'object', 'properties': {}, 'required': []}
}]


def load_tools():
    p = os.path.join(HERE, 'tools.json')
    tools = []
    if os.path.exists(p):
        with open(p, encoding='utf-8') as f:
            tools = json.load(f)
    out = list(LOCAL_TOOLS)
    for t in tools:
        schema = json.loads(json.dumps(t['input_schema']))
        props = schema.setdefault('properties', {})
        if t['name'] == 'gb_load_file':  # from MCP: read the file from disk here
            props.pop('data_b64', None); props.pop('name', None)
            props['path'] = {'type': 'string', 'description': 'absolute path of the file on this computer (GLB/FBX/OBJ model, or MP4/MOV video for mocap)'}
            schema['required'] = ['page', 'path']
        if t['name'] in ('gb_sfx', 'gb_drive'):  # from MCP: the video is read from disk here
            props.pop('video_b64', None)
            props['path'] = {'type': 'string', 'description': 'for load: absolute path of the finished video (MP4 / MOV) on this computer'}
        if t['name'] == 'gb_drama':  # from MCP: pictures / clips are read from disk here; merge runs ffmpeg here
            props.pop('data_b64', None); props.pop('mime', None)
            props['path'] = {'type': 'string', 'description': 'char / clip: absolute path of the picture or video on this computer'}
            props['url'] = {'type': 'string', 'description': 'char / clip: OR a link to the picture / video (e.g. the Higgsfield result: the image / video src or its download link); this computer downloads it (copy in Greenbox/exports/drama/downloads)'}
            props['save_to'] = {'type': 'string', 'description': 'merge: where to save the joined MP4 (folder or file); default Greenbox/exports/drama'}
        if t['name'] in ('gb_export', 'gb_map', 'gb_hpbar', 'gb_sfx', 'gb_drive'):
            props['save_to'] = {'type': 'string', 'description': 'absolute path (folder or file) to save an exported file to; default: Greenbox/exports or ~/Greenbox-exports'}
        out.append({'name': t['name'], 'description': t['description'], 'inputSchema': schema})
    return out


# ------------------------------------------------------------------ relay (web version) ------------------------------------------------------------------
def origin_ok(origin):
    if not origin:
        return False
    o = origin.lower()
    if o in [x.lower() for x in EXTRA_ORIGINS]:
        return True
    for pre in ('http://localhost', 'http://127.0.0.1', 'https://localhost', 'https://127.0.0.1'):
        if o == pre or o.startswith(pre + ':'):
            return True
    return o.startswith('https://') and o.endswith('.github.io')


class Relay:
    """jobs for the Greenbox tab: the tab long-polls /poll (with the pairing code), runs the tool, posts /result"""

    def __init__(self):
        self.code = '%06d' % secrets.randbelow(1000000)
        self.token = secrets.token_hex(16)  # for a second MCP process (Claude + Codex at once) to use this relay
        self.jobs = queue.Queue()
        self.waiting = {}
        self.last_poll = 0.0
        self.origin = None
        self.port = 0

    def connected(self):
        return time.time() - self.last_poll < 40

    def call(self, tool, args, timeout=300):
        if not self.connected():
            raise RuntimeError(not_connected_text(self))
        jid = uuid.uuid4().hex
        ev = threading.Event(); self.waiting[jid] = [ev, None]
        self.jobs.put({'id': jid, 'tool': tool, 'args': args})
        if not ev.wait(timeout):
            self.waiting.pop(jid, None)
            raise RuntimeError('Greenbox did not answer in %ds (is the tab still open?)' % timeout)
        res = self.waiting.pop(jid)[1] or {}
        if not res.get('ok'):
            raise RuntimeError(res.get('error') or 'Greenbox error')
        return res.get('result') or {}

    def serve(self):
        relay = self

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *a):
                pass

            def cors(self):
                o = self.headers.get('Origin')
                if origin_ok(o):
                    self.send_header('Access-Control-Allow-Origin', o)
                    self.send_header('Vary', 'Origin')
                    self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Greenbox-Pair, X-Greenbox-Token')
                    self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                    self.send_header('Access-Control-Allow-Private-Network', 'true')  # Chrome: public site -> localhost

            def reply(self, code, obj=None):
                body = b'' if obj is None else json.dumps(obj).encode()
                self.send_response(code); self.cors()
                self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control', 'no-store')
                self.end_headers(); self.wfile.write(body)

            def body(self):
                n = int(self.headers.get('Content-Length') or 0)
                return json.loads(self.rfile.read(n) or b'{}') if n else {}

            def paired(self):
                return secrets.compare_digest(self.headers.get('X-Greenbox-Pair') or '', relay.code) and (origin_ok(self.headers.get('Origin')) or not self.headers.get('Origin'))

            def do_OPTIONS(self):
                self.send_response(204); self.cors(); self.send_header('Content-Length', '0'); self.end_headers()

            def do_GET(self):
                path = self.path.split('?')[0]
                if path == '/hello':  # no secret here: lets the page say "relay found, type the code"
                    return self.reply(200, {'greenbox_mcp': 1, 'connected': relay.connected()})
                if path == '/poll':
                    if not self.paired():
                        return self.reply(401, {'error': 'wrong pairing code'})
                    relay.last_poll = time.time(); relay.origin = self.headers.get('Origin')
                    try:
                        job = relay.jobs.get(timeout=20)
                    except queue.Empty:
                        relay.last_poll = time.time()
                        return self.reply(204)
                    return self.reply(200, job)
                return self.reply(404, {'error': 'not found'})

            def do_POST(self):
                path = self.path.split('?')[0]
                if path == '/result':
                    if not self.paired():
                        return self.reply(401, {'error': 'wrong pairing code'})
                    d = self.body(); w = relay.waiting.get(d.get('id'))
                    if w is not None:
                        w[1] = d; w[0].set()
                    return self.reply(200, {'ok': True})
                if path == '/call':  # another MCP process on this computer (needs the token from ~/.greenbox/relay.json)
                    if self.headers.get('Origin') or not secrets.compare_digest(self.headers.get('X-Greenbox-Token') or '', relay.token):
                        return self.reply(403, {'ok': False, 'error': 'forbidden'})
                    d = self.body()
                    try:
                        return self.reply(200, {'ok': True, 'result': relay.call(d.get('tool'), d.get('args') or {}, int(d.get('timeout') or 300))})
                    except Exception as e:
                        return self.reply(200, {'ok': False, 'error': str(e)})
                if path == '/code':  # same: lets the second process show the same pairing code
                    if self.headers.get('Origin') or not secrets.compare_digest(self.headers.get('X-Greenbox-Token') or '', relay.token):
                        return self.reply(403, {'ok': False})
                    return self.reply(200, {'ok': True, 'code': relay.code, 'connected': relay.connected(), 'port': relay.port})
                return self.reply(404, {'error': 'not found'})

        class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
            daemon_threads = True
            allow_reuse_address = False

        for port in range(BASE_PORT, BASE_PORT + 6):
            try:
                srv = S(('127.0.0.1', port), H)
            except OSError:
                continue
            self.port = port
            os.makedirs(HOME, exist_ok=True)
            with open(RELAY_FILE, 'w') as f:
                json.dump({'port': port, 'token': self.token, 'pid': os.getpid()}, f)
            try:
                os.chmod(RELAY_FILE, 0o600)
            except OSError:
                pass
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            return True
        return False


def not_connected_text(r):
    return ('Greenbox is not connected yet. Ask the user to open Greenbox (web or Mo-Greenbox), click 🤖 AI → ⚙ → '
            '"Claude / Codex (MCP)", and type the pairing code %s (port %d). Then call the tool again.' % (r['code'], r['port'])
            if isinstance(r, dict) else
            'Greenbox is not connected yet. Ask the user to open Greenbox (web or Mo-Greenbox), click 🤖 AI → ⚙ → '
            '"Claude / Codex (MCP)", and type the pairing code %s (port %d). Then call the tool again.' % (r.code, r.port))


# ------------------------------------------------------------------ how calls reach the browser ------------------------------------------------------------------
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # never through a proxy: it is localhost


def _post(url, payload, headers, timeout):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=dict({'Content-Type': 'application/json'}, **headers), method='POST')
    try:
        with _opener.open(req, timeout=timeout) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read() or b'{}')
        except ValueError:
            return {'ok': False, 'error': 'HTTP %d' % e.code}


class Link:
    """serve.py bridge (local Greenbox) first, then a relay already started by another MCP process, else our own relay"""

    def __init__(self):
        self.relay = None

    def local_bridge(self):
        """the running Greenbox server: .bridge.json first, else any live .bridge-<port>.json (several servers / a stale file)"""
        import glob
        files = [os.path.join(HERE, '.bridge.json')] + sorted(glob.glob(os.path.join(HERE, '.bridge-*.json')), key=lambda f: -os.path.getmtime(f))
        want = os.environ.get('GREENBOX_PORT')   # started by a Greenbox server's own chat (cli_agent.py): talk to that server
        if want and want.isdigit():
            files.insert(0, os.path.join(HERE, '.bridge-%s.json' % want))
        for p in files:
            try:
                with open(p) as f:
                    info = json.load(f)
                _opener.open(urllib.request.Request('http://127.0.0.1:%d/bridge/status' % info['port'], headers={'Host': 'localhost'}), timeout=1.5).read()
                return info
            except Exception:
                continue
        return None

    def shared_relay(self):
        if self.relay is not None or not os.path.exists(RELAY_FILE):
            return None
        try:
            with open(RELAY_FILE) as f:
                info = json.load(f)
            res = _post('http://127.0.0.1:%d/code' % info['port'], {}, {'X-Greenbox-Token': info['token']}, 2)
            return info if res.get('ok') else None
        except Exception:
            return None

    def own_relay(self):
        if self.relay is None:
            r = Relay()
            if r.serve():
                self.relay = r
        return self.relay

    def pairing(self):
        sr = self.shared_relay()
        if sr is not None:
            res = _post('http://127.0.0.1:%d/code' % sr['port'], {}, {'X-Greenbox-Token': sr['token']}, 2)
            return {'code': res.get('code'), 'port': res.get('port'), 'connected': res.get('connected')}
        r = self.own_relay()
        if r is None:
            return None
        return {'code': r.code, 'port': r.port, 'connected': r.connected()}

    def call(self, tool, args, timeout=300):
        lb = self.local_bridge()
        if lb is not None:
            res = _post('http://127.0.0.1:%d/bridge/call' % lb['port'], {'tool': tool, 'args': args, 'timeout': timeout},
                        {'X-Greenbox-Token': lb['token'], 'Host': 'localhost'}, timeout + 10)
            if res.get('ok'):
                return res.get('result') or {}
            # the local page may be closed while a web tab is paired: try the relay, else report the local error
            p = self.pairing()
            if p is None or not p.get('connected'):
                raise RuntimeError(res.get('error') or 'Greenbox error')
        sr = self.shared_relay()
        if sr is not None:
            res = _post('http://127.0.0.1:%d/call' % sr['port'], {'tool': tool, 'args': args, 'timeout': timeout}, {'X-Greenbox-Token': sr['token']}, timeout + 10)
            if not res.get('ok'):
                raise RuntimeError(res.get('error') or 'Greenbox error')
            return res.get('result') or {}
        r = self.own_relay()
        if r is None:
            raise RuntimeError('Could not open the Greenbox relay on 127.0.0.1:%d-%d (ports busy).' % (BASE_PORT, BASE_PORT + 5))
        return r.call(tool, args, timeout)


LINK = Link()


def exports_dir():
    d = os.path.join(os.path.dirname(HERE), 'exports')
    return d if os.access(os.path.dirname(HERE), os.W_OK) else os.path.join(os.path.expanduser('~'), 'Greenbox-exports')


# the AI app this process serves (from MCP initialize clientInfo): shown on its messages in the Greenbox chat
CLIENT = {'name': 'Claude'}


def client_label(info):
    n = str((info or {}).get('name') or '').strip()
    low = n.lower()
    if 'codex' in low:
        return 'Codex'
    if 'claude-code' in low or low == 'claude code':
        return 'Claude Code'
    if 'claude' in low:
        return 'Claude'
    if 'cursor' in low:
        return 'Cursor'
    if 'vscode' in low or 'visual studio code' in low or 'copilot' in low:
        return 'VS Code'
    return n or 'AI'


def run_tool(name, args):
    args = dict(args or {})
    if name == 'gb_connect':
        lb = LINK.local_bridge()
        p = LINK.pairing()
        lines = []
        if lb is not None:
            lines.append('Local Greenbox (Mo-Greenbox) found: it connects by itself, nothing to type.')
        if p is not None:
            lines.append('Web Greenbox: the user opens Greenbox, clicks 🤖 AI → ⚙ → "Claude / Codex (MCP)" and types the code %s (port %s). %s'
                         % (p['code'], p['port'], 'A Greenbox tab is connected now.' if p.get('connected') else 'No tab connected yet.'))
        return [{'type': 'text', 'text': '\n'.join(lines) or 'Could not open the relay.'}]
    if name == 'gb_drama':
        if args.get('action') == 'merge':
            return drama_merge(args)
        if args.get('action') == 'node_compose':
            return drama_node_compose(args)
        if args.get('url') and not args.get('path'):
            args['path'] = drama_download(args.pop('url'), args.get('action'), args.get('name') or args.get('id') or 'ep%s_beat%s' % (args.get('ep'), args.get('beat')))
        if args.get('path'):
            path = os.path.expanduser(args.pop('path'))
            with open(path, 'rb') as f:
                args['data_b64'] = base64.b64encode(f.read()).decode()
            args['mime'] = mimetypes.guess_type(path)[0] or ('video/mp4' if args.get('action') == 'clip' else 'audio/mpeg' if args.get('action') in ('voice', 'music') else 'image/png')
    if name == 'gb_load_file':
        path = os.path.expanduser(args.pop('path', ''))
        with open(path, 'rb') as f:
            args['data_b64'] = base64.b64encode(f.read()).decode()
        args['name'] = os.path.basename(path)
    if name == 'gb_drive' and args.get('url') and not args.get('path'):  # a picture / video link (Higgsfield…): fetch it here
        args['path'] = drama_download(args.pop('url'), 'clip' if args.get('action') == 'load' else 'char', args.get('slot') or args.get('name') or 'drive')
    if name == 'gb_drive' and args.get('path') and LINK.local_bridge() is not None:
        # local Greenbox: hand the page a link on its own server instead of base64 in the call
        # (a 10-30 MB video as base64 made the call time out and dropped the bridge)
        src = os.path.expanduser(args.pop('path'))
        if not os.path.isfile(src):
            raise RuntimeError('file not found: %s' % src)
        folder = os.path.join(os.path.dirname(HERE), 'exports', '_mcp_in')
        os.makedirs(folder, exist_ok=True)
        base = re.sub(r'[^\w.-]+', '_', os.path.basename(src)) or 'file'
        dst = os.path.join(folder, '%s-%s' % (time.strftime('%H%M%S'), base))
        try:
            os.link(src, dst)
        except OSError:
            shutil.copyfile(src, dst)
        args['file_url'] = '/exports/_mcp_in/' + os.path.basename(dst)
        args['name'] = os.path.basename(src)
    if name in ('gb_sfx', 'gb_drive') and args.get('path'):
        path = os.path.expanduser(args.pop('path'))
        with open(path, 'rb') as f:
            args['video_b64'] = base64.b64encode(f.read()).decode()
        args['name'] = os.path.basename(path)
    save_to = args.pop('save_to', None)
    args['__from'] = CLIENT['name']  # the Greenbox tab strips it and labels the call / message with it
    # gb_inbox may wait up to 50 s for the user's answer
    res = LINK.call(name, args)
    content = []
    if res.get('file'):
        fname = res['file']['name']
        target = os.path.expanduser(save_to) if save_to else exports_dir()
        if save_to is None or os.path.isdir(target) or target.endswith(os.sep):
            os.makedirs(target, exist_ok=True); target = os.path.join(target, fname)
        else:
            os.makedirs(os.path.dirname(target) or '.', exist_ok=True)
        with open(target, 'wb') as f:
            f.write(base64.b64decode(res['file']['b64']))
        content.append({'type': 'text', 'text': 'saved %s' % target})
    if res.get('saved') and save_to:  # the page already wrote it under Greenbox/exports: move it where asked
        target = os.path.expanduser(save_to)
        if os.path.isdir(target) or target.endswith(os.sep):
            os.makedirs(target, exist_ok=True); target = os.path.join(target, os.path.basename(res['saved']))
        else:
            os.makedirs(os.path.dirname(target) or '.', exist_ok=True)
        shutil.move(res['saved'], target)
        content.append({'type': 'text', 'text': 'saved %s' % target})
    if res.get('text'):
        content.append({'type': 'text', 'text': res['text']})
    img = res.get('image')
    if img and img.startswith('data:'):
        head, data = img.split(',', 1)
        content.append({'type': 'image', 'data': data, 'mimeType': head[5:].split(';')[0]})
    return content or [{'type': 'text', 'text': 'ok'}]




def drama_download(url, action, label):
    """🎬 AI Drama: fetch a picture / clip link (Higgsfield result, CDN…) on this computer and keep a copy in
    Greenbox/exports/drama/downloads, so an AI that cannot save files itself can still hand results to Greenbox"""
    if not re.match(r'^https?://', str(url or '')):
        raise RuntimeError('url must start with http:// or https://')
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh) Greenbox/1.0', 'Accept': '*/*'})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
        ctype = (r.headers.get('Content-Type') or '').split(';')[0].strip()
    if len(data) < 64:
        raise RuntimeError('the link returned almost nothing (%d bytes): it may need a sign-in or have expired' % len(data))
    if ctype.startswith('text/html'):
        raise RuntimeError('the link is a web page, not the file: use the picture / video address itself (img / video src or the download link)')
    ext = mimetypes.guess_extension(ctype) if ctype else None
    if not ext:
        ext = os.path.splitext(urllib.parse.urlparse(url).path)[1] or ('.mp4' if action == 'clip' else '.png')
    if ext in ('.jpe', '.jpeg'):
        ext = '.jpg'
    folder = os.path.join(exports_dir(), 'drama', 'downloads')
    os.makedirs(folder, exist_ok=True)
    safe = re.sub(r'[^\w-]+', '-', str(label), flags=re.UNICODE).strip('-') or 'file'
    path = os.path.join(folder, '%s-%s%s' % (safe, time.strftime('%Y%m%d-%H%M%S'), ext))
    with open(path, 'wb') as f:
        f.write(data)
    return path


def _ffmpeg(tool='ffmpeg'):
    for c in (shutil.which(tool), '/opt/homebrew/bin/' + tool, '/usr/local/bin/' + tool, '/usr/bin/' + tool):
        if c and os.path.exists(c):
            return c
    raise RuntimeError('%s not found: install it (mac: brew install ffmpeg)' % tool)


def drama_merge(args):
    """🎬 AI Drama: join one episode's clips in beat order (ffmpeg on this computer) and put the MP4 back on the page"""
    ep = int(args.get('ep', 0))
    state = json.loads(LINK.call('gb_drama', {'action': 'get', '__from': CLIENT['name']}).get('text') or '{}')
    eps = ((state.get('script') or {}).get('eps') or [])
    if ep >= len(eps):
        raise RuntimeError('no episode %d' % ep)
    vertical = (state.get('settings') or {}).get('ratio', '9:16') == '9:16'
    W, H = (1080, 1920) if vertical else (1920, 1080)
    ff, fp = _ffmpeg(), _ffmpeg('ffprobe')
    work = tempfile.mkdtemp(prefix='gb-drama-')
    compose = state.get('compose') or {}
    parts = []
    for j, b in enumerate(eps[ep].get('beats') or []):
        if not b.get('clip'):
            continue
        r = LINK.call('gb_drama', {'action': 'clip_out', 'ep': ep, 'beat': j, '__from': CLIENT['name']})
        f = (r or {}).get('file')
        if not f:
            continue
        src = os.path.join(work, f['name'])
        with open(src, 'wb') as o:
            o.write(base64.b64decode(f['b64']))
        voice = None
        if compose.get('voice', True) and any(a.get('ep') == ep and a.get('beat') == j and a.get('has_voice') for a in state.get('audio') or []):
            voice = _media(work, {'what': 'voice', 'ep': ep, 'beat': j})
        parts.append(drama_norm(ff, fp, src, os.path.join(work, 'n%02d.mp4' % j), W, H, voice))
    if not parts:
        raise RuntimeError('episode %d has no clips yet' % (ep + 1))
    title = ((state.get('script') or {}).get('title') or 'drama')
    safe = re.sub(r'[^\w-]+', '-', title, flags=re.UNICODE).strip('-') or 'drama'
    name = '%s-%s.mp4' % (safe, ep + 1)
    save_to = args.get('save_to')
    target = os.path.expanduser(save_to) if save_to else os.path.join(exports_dir(), 'drama')
    if save_to is None or os.path.isdir(target) or target.endswith(os.sep):
        os.makedirs(target, exist_ok=True); target = os.path.join(target, name)
    else:
        os.makedirs(os.path.dirname(target) or '.', exist_ok=True)
    drama_concat(ff, parts, target)
    extra = []
    music = _media(work, {'what': 'music', 'ep': ep}) if compose.get('music', True) and any(m.get('ep') == ep and m.get('has_music') for m in state.get('music') or []) else None
    srt = None
    if compose.get('subs'):
        txt = LINK.call('gb_drama', {'action': 'srt', 'ep': ep, '__from': CLIENT['name']}).get('text') or ''
        if txt.strip():
            srt = os.path.splitext(target)[0] + '.srt'
            with open(srt, 'w', encoding='utf-8') as o:
                o.write(txt)
    if music or srt:
        tmp = os.path.join(work, 'mix.mp4'); cmd = [ff, '-y', '-v', 'error', '-i', target]
        if music:
            cmd += ['-stream_loop', '-1', '-i', music]
        if srt:
            cmd += ['-i', srt]
        if music:
            cmd += ['-filter_complex', '[1:a]volume=0.22[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]', '-map', '0:v', '-map', '[a]', '-c:a', 'aac']
            extra.append('music')
        else:
            cmd += ['-map', '0:v', '-map', '0:a', '-c:a', 'copy']
        if srt:
            cmd += ['-map', '%d:s' % (2 if music else 1), '-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie']
            extra.append('subtitles (track + %s)' % os.path.basename(srt))
        cmd += ['-c:v', 'copy', '-movflags', '+faststart', tmp]
        subprocess.run(cmd, check=True, capture_output=True); shutil.move(tmp, target)
    with open(target, 'rb') as f:
        LINK.call('gb_drama', {'action': 'merged', 'ep': ep, 'data_b64': base64.b64encode(f.read()).decode(), '__from': CLIENT['name']})
    shutil.rmtree(work, ignore_errors=True)
    return [{'type': 'text', 'text': 'joined %d clips%s -> %s (also shown on the AI Drama page)' % (len(parts), (' + ' + ', '.join(extra)) if extra else '', target)}]


def _media(work, what):
    """a stored picture / clip / voice of the AI Drama page -> a file in work (None when there is none)"""
    r = LINK.call('gb_drama', dict(what, action='media_out', __from=CLIENT['name']))
    f = (r or {}).get('file')
    if not f:
        return None
    path = os.path.join(work, f['name'])
    with open(path, 'wb') as o:
        o.write(base64.b64decode(f['b64']))
    return path


def drama_node_compose(args):
    """🧩 Freezone: join the video nodes wired into a compose node (in wire order) and put the MP4 into that node"""
    state = json.loads(LINK.call('gb_drama', {'action': 'get', '__from': CLIENT['name']}).get('text') or '{}')
    fz = state.get('freezone') or {}; nid = str(args.get('id'))
    nodes = {n['id']: n for n in fz.get('nodes') or []}
    ins = [e['a'] for e in fz.get('edges') or [] if e.get('b') == nid and nodes.get(e['a'], {}).get('has_media')]
    if not ins:
        raise RuntimeError('no video nodes with a clip are wired into %s' % nid)
    vertical = (state.get('settings') or {}).get('ratio', '9:16') == '9:16'
    W, H = (1080, 1920) if vertical else (1920, 1080)
    ff, fp = _ffmpeg(), _ffmpeg('ffprobe'); work = tempfile.mkdtemp(prefix='gb-fz-')
    parts = [drama_norm(ff, fp, _media(work, {'what': 'node', 'id': a}), os.path.join(work, 'n%02d.mp4' % i), W, H) for i, a in enumerate(ins)]
    target = os.path.join(exports_dir(), 'drama', 'freezone-%s-%s.mp4' % (nid, time.strftime('%Y%m%d-%H%M%S')))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    drama_concat(ff, parts, target)
    with open(target, 'rb') as f:
        LINK.call('gb_drama', {'action': 'node', 'id': nid, 'data_b64': base64.b64encode(f.read()).decode(), 'mime': 'video/mp4', '__from': CLIENT['name']})
    shutil.rmtree(work, ignore_errors=True)
    return [{'type': 'text', 'text': 'joined %d video nodes -> %s (in node %s)' % (len(parts), target, nid)}]


def drama_norm(ff, fp, src, out, W, H, voice=None):
    """one clip -> W x H, 30 fps, H.264 + AAC stereo (silence added when the clip has no sound), so they concat cleanly"""
    has_audio = subprocess.run([fp, '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', src], capture_output=True, text=True).stdout.strip() != ''
    vf = 'scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30' % (W, H, W, H)
    cmd = [ff, '-y', '-v', 'error', '-i', src]
    if not has_audio:
        cmd += ['-f', 'lavfi', '-t', '3600', '-i', 'anullsrc=r=44100:cl=stereo']
    if voice:  # the beat's voice-over on top of the clip sound (clip sound lowered)
        ca, vi = (0, 1) if has_audio else (1, 2)
        cmd += ['-i', voice, '-filter_complex', '[0:v]%s[v];[%d:a]volume=0.35[b];[b][%d:a]amix=inputs=2:duration=first:normalize=0,aresample=44100[a]' % (vf, ca, vi), '-map', '[v]', '-map', '[a]']
        cmd += ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-t', _dur(fp, src), out]
        subprocess.run(cmd, check=True, capture_output=True)
        return out
    cmd += ['-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-t', _dur(fp, src), out]
    subprocess.run(cmd, check=True, capture_output=True)
    return out


def _dur(fp, src):
    return subprocess.run([fp, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], capture_output=True, text=True).stdout.strip() or '3600'


def drama_concat(ff, parts, target):
    lst = target + '.list.txt'
    with open(lst, 'w') as o:
        o.write(''.join("file '%s'\n" % p.replace("'", "'\\''") for p in parts))
    try:
        subprocess.run([ff, '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', '-movflags', '+faststart', target], check=True, capture_output=True)
    finally:
        os.remove(lst)


# 🎮 MCP prompt: Claude Code shows it as /mcp__greenbox__make_playable, Claude Desktop in its prompt list
RECIPE = "Make a playable ad with Greenbox, from a 3D model to one HTML file. The user watches Greenbox: narrate each step in ONE short line with gb_say before you do it, and when a choice is theirs (joint placement looks off, game idea, map look) ask with gb_say and wait with gb_inbox {wait: 50}.\n1. gb_status. If Greenbox is not connected: gb_connect and give the user the pairing code.\n2. Character: gb_load_file {page: \"create\", path: MODEL}. Then gb_rig_auto (finds the body and places the joints) and gb_screenshot {page: \"create\"}: look at it; if a joint is outside the body, read them with gb_joints_get and fix with gb_joints_set. Then gb_rig_finish (skin + 178 animations). (Already rigged file: load it straight into Play test with gb_load_file {page: \"playtest\"} and skip to 4.)\n3. gb_to_playtest: the rigged character becomes the Play test player.\n4. Map: gb_map {action: \"preset\", preset: \"flat\"} (or hills / island\u2026), keep it small (about 40 x 40 m). Decorate lightly with gb_map add (trees, rocks, fences; a house = hwall pieces round a room + door + roof). Every object adds weight to the file.\n5. Gameplay = a 2D plan: gb_map {action: \"plan\", plan: {shapes, wires}, play: false}. Shapes (x, z = centre in metres, w, d = size, r = turn in rad, label, color, height): player (where the player starts), source (gives an item: gives = \"coin\" / \"wood\"\u2026, time = seconds per item), machine (takes \u2192 gives), stack / counter (counter sells items for $), unlock ($ pad, price = cost; what it unlocks is joined with an \"unlock\" wire), zone (floor), block (solid wall / box, model = a palette object such as \"house\" or \"pine\"), camera. Wires {id, from, to, mode}: carry (the player carries items from \u2192 to), belt (a conveyor), unlock (pad \u2192 what appears when paid). A classic loop: player \u2192 source (coins) carry\u2192 counter \u2192 unlock pad \u2192 new building.\n6. Test: gb_map {action: \"plan\", plan, play: true}, then gb_screenshot {page: \"playtest\"}. Fix what looks wrong.\n7. Export: gb_map {action: \"export_playable\", cta: STORE_LINK (or \"\")}; the MCP saves greenbox-playable.html (save_to = a folder or file to choose where). Tell the user the path and the size: ad networks usually want under 5 MB \u2014 if bigger, remove decoration / shrink the map and export again."
PROMPTS = [{'name': 'make_playable', 'description': 'Make a playable ad from a 3D model with Greenbox (rig, map, gameplay, HTML export), narrated in the Greenbox side chat',
            'arguments': [{'name': 'model', 'description': 'path of the 3D model (GLB / FBX / OBJ) on this computer', 'required': True},
                          {'name': 'game', 'description': 'the game idea in a few words (e.g. pick up coins, unlock a house)', 'required': False},
                          {'name': 'link', 'description': 'store / landing link for the Play now button', 'required': False}]},
           {'name': 'ai_drama', 'description': 'Work the Greenbox AI Drama page: listen to its buttons (script, characters on Higgsfield, clips, joining) and do them live',
            'arguments': []}]

DRAMA_PROMPT = ('Work the Greenbox AI Drama page with me. 1) gb_drama {action: "open"} and gb_drama {action: "say", text: "Claude đã kết nối AI Drama, đang nghe các nút bấm."}. '
                '2) Read the gb_drama tool description: it is the full recipe (requests, script format, long films in parts, Higgsfield, credits, merge). '
                '3) Loop: gb_inbox {wait: 50}; for every "[AI Drama #N] kind" message do that request (gb_drama {action: "get"} first) and finish with gb_drama {action: "done", id: N}; '
                'plain messages are from me — answer them with gb_say. Keep looping (an empty inbox is normal) until I say stop. '
                'Ask before spending Higgsfield credits; never sign in for me.')


def prompt_text(args):
    a = args or {}
    return (RECIPE.replace('MODEL', json.dumps(a.get('model') or '<ask the user for the model path>')).replace('STORE_LINK', json.dumps(a.get('link') or ''))
            + '\n\nGame idea: ' + (a.get('game') or 'ask the user in one line (gb_say + gb_inbox); if they do not answer, make a coin pick-up loop that unlocks a house.'))


def send(msg):
    sys.stdout.write(json.dumps(msg) + '\n'); sys.stdout.flush()


def main():
    tools = load_tools()
    # open the relay right away (unless a local Greenbox or another MCP process already has one), so the
    # Greenbox tab can pair before the first tool call
    if LINK.local_bridge() is None and LINK.shared_relay() is None:
        LINK.own_relay()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        mid = msg.get('id'); method = msg.get('method')
        if mid is None:  # notification
            continue
        try:
            if method == 'initialize':
                CLIENT['name'] = client_label((msg.get('params') or {}).get('clientInfo'))
                result = {'protocolVersion': (msg.get('params') or {}).get('protocolVersion') or PROTOCOL,
                          'capabilities': {'tools': {}, 'prompts': {}}, 'serverInfo': {'name': 'greenbox', 'version': '2.0'},
                          'instructions': 'Greenbox drives a browser tab (3D rigging, vehicles, play-test maps, HP-bar video). If a tool says it is not connected, call gb_connect and tell the user the pairing code. The user watches Greenbox with a side chat next to the 3D view: post short updates, results and questions there with gb_say, and read their replies with gb_inbox (wait up to 50 s when you asked something). To make a playable ad from a model, call gb_recipe first and follow it.'}
            elif method == 'tools/list':
                result = {'tools': tools}
            elif method == 'tools/call':
                p = msg.get('params') or {}
                try:
                    result = {'content': run_tool(p.get('name'), p.get('arguments'))}
                except Exception as e:  # tool errors go back to the model, not as protocol errors
                    result = {'content': [{'type': 'text', 'text': 'ERROR: %s' % e}], 'isError': True}
            elif method == 'prompts/list':
                result = {'prompts': PROMPTS}
            elif method == 'prompts/get':
                p = msg.get('params') or {}
                if p.get('name') == 'ai_drama':
                    result = {'description': PROMPTS[1]['description'], 'messages': [{'role': 'user', 'content': {'type': 'text', 'text': DRAMA_PROMPT}}]}
                elif p.get('name') != 'make_playable':
                    send({'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32602, 'message': 'unknown prompt'}}); continue
                else:
                    result = {'description': PROMPTS[0]['description'], 'messages': [{'role': 'user', 'content': {'type': 'text', 'text': prompt_text(p.get('arguments'))}}]}
            elif method == 'ping':
                result = {}
            else:
                send({'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32601, 'message': 'method not found: %s' % method}}); continue
            send({'jsonrpc': '2.0', 'id': mid, 'result': result})
        except Exception as e:
            send({'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32603, 'message': str(e)}})


if __name__ == '__main__':
    main()
