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
        p = os.path.join(HERE, '.bridge.json')
        if not os.path.exists(p):
            return None
        try:
            with open(p) as f:
                info = json.load(f)
            _opener.open(urllib.request.Request('http://127.0.0.1:%d/bridge/status' % info['port'], headers={'Host': 'localhost'}), timeout=1.5).read()
            return info
        except Exception:
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
    if name == 'gb_load_file':
        path = os.path.expanduser(args.pop('path', ''))
        with open(path, 'rb') as f:
            args['data_b64'] = base64.b64encode(f.read()).decode()
        args['name'] = os.path.basename(path)
    if name in ('gb_sfx', 'gb_drive') and args.get('path'):
        path = os.path.expanduser(args.pop('path'))
        with open(path, 'rb') as f:
            args['video_b64'] = base64.b64encode(f.read()).decode()
        args['name'] = os.path.basename(path)
    save_to = args.pop('save_to', None)
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
    if res.get('text'):
        content.append({'type': 'text', 'text': res['text']})
    img = res.get('image')
    if img and img.startswith('data:'):
        head, data = img.split(',', 1)
        content.append({'type': 'image', 'data': data, 'mimeType': head[5:].split(';')[0]})
    return content or [{'type': 'text', 'text': 'ok'}]


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
                result = {'protocolVersion': (msg.get('params') or {}).get('protocolVersion') or PROTOCOL,
                          'capabilities': {'tools': {}}, 'serverInfo': {'name': 'greenbox', 'version': '2.0'},
                          'instructions': 'Greenbox drives a browser tab (3D rigging, vehicles, play-test maps, HP-bar video). If a tool says it is not connected, call gb_connect and tell the user the pairing code.'}
            elif method == 'tools/list':
                result = {'tools': tools}
            elif method == 'tools/call':
                p = msg.get('params') or {}
                try:
                    result = {'content': run_tool(p.get('name'), p.get('arguments'))}
                except Exception as e:  # tool errors go back to the model, not as protocol errors
                    result = {'content': [{'type': 'text', 'text': 'ERROR: %s' % e}], 'isError': True}
            elif method == 'ping':
                result = {}
            else:
                send({'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32601, 'message': 'method not found: %s' % method}}); continue
            send({'jsonrpc': '2.0', 'id': mid, 'result': result})
        except Exception as e:
            send({'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32603, 'message': str(e)}})


if __name__ == '__main__':
    main()
