"""Greenbox MCP bridge (server side, mounted by serve.py under /bridge).

  POST /bridge/call    {tool, args}  -> waits for the browser to run it -> {ok, result | error}
                       needs header X-Greenbox-Token (written to gb-ai/.bridge.json at start: only local
                       programs that can read that file, i.e. greenbox_mcp.py, can drive Greenbox)
  GET  /bridge/poll    the Greenbox cockpit waits here for the next call (long poll)
  POST /bridge/result  the cockpit returns the result of a call
  GET  /bridge/status  what the AI side looks like (MCP calls seen, Claude Desktop config found / set up)
  POST /bridge/blender {name, glb_b64, script}   saves a Rigify kit into Greenbox/exports/ and opens it in
                       Blender (same Greenbox-page-only rule as install-claude)
  POST /bridge/install-claude   adds Greenbox to Claude Desktop's MCP config (backup first). Only from the
                       Greenbox page itself: needs header X-Greenbox-UI and a localhost Origin.
Works with Python 3.8+.
"""
import collections
import json
import os
import platform
import queue
import secrets
import base64
import glob
import shutil
import subprocess
import sys
import threading
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = secrets.token_hex(16)
_jobs = queue.Queue()
_waiting = {}  # id -> [Event, result]
_last_poll = {'t': 0.0}
_activity = collections.deque(maxlen=30)  # recent MCP tool calls: {'t', 'tool'}
_port = {'p': 0}


def claude_config_path():
    """where Claude Desktop keeps its MCP server list on this computer"""
    sysname = platform.system()
    if sysname == 'Darwin':
        return os.path.expanduser('~/Library/Application Support/Claude/claude_desktop_config.json')
    if sysname == 'Windows':
        return os.path.join(os.environ.get('APPDATA') or os.path.expanduser('~\\AppData\\Roaming'), 'Claude', 'claude_desktop_config.json')
    return os.path.expanduser('~/.config/Claude/claude_desktop_config.json')


def mcp_entry():
    return {'command': sys.executable or 'python3', 'args': [os.path.join(HERE, 'greenbox_mcp.py')]}


def claude_status():
    path = claude_config_path()
    out = {'config': path, 'app_found': os.path.isdir(os.path.dirname(path)), 'installed': False, 'entry': mcp_entry()}
    try:
        with open(path, encoding='utf-8') as f:
            cfg = json.load(f)
        g = (cfg.get('mcpServers') or {}).get('greenbox')
        out['installed'] = bool(g) and os.path.abspath((g.get('args') or [''])[-1]) == os.path.abspath(mcp_entry()['args'][0])
    except (OSError, ValueError):
        pass
    return out


def find_blender():
    """Blender's program on this computer (newest version first), or None"""
    env = os.environ.get('GREENBOX_BLENDER')
    if env and os.path.exists(env):
        return env
    sysname = platform.system()
    cands = []
    if sysname == 'Darwin':
        for base in ('/Applications', os.path.expanduser('~/Applications')):
            cands += sorted(glob.glob(os.path.join(base, 'Blender*.app/Contents/MacOS/Blender')), reverse=True)
    elif sysname == 'Windows':
        for base in (os.environ.get('ProgramFiles', r'C:\Program Files'), os.environ.get('ProgramFiles(x86)', '')):
            if base:
                cands += sorted(glob.glob(os.path.join(base, 'Blender Foundation', 'Blender*', 'blender.exe')), reverse=True)
        cands += sorted(glob.glob(os.path.expanduser(r'~\AppData\Local\Programs\Blender Foundation\Blender*\blender.exe')), reverse=True)
    w = shutil.which('blender')
    if w:
        cands.append(w)
    for c in cands:
        if os.path.exists(c):
            return c
    return None


def open_in_blender(name, glb, script):
    """write <exports>/<name>-<time>/ {name}.glb + {name}.py and start Blender running the script"""
    safe = ''.join(ch for ch in (name or 'greenbox') if ch.isalnum() or ch in '-_') or 'greenbox'
    folder = os.path.join(os.path.dirname(HERE), 'exports', '%s-%s' % (safe, time.strftime('%Y%m%d-%H%M%S')))
    os.makedirs(folder, exist_ok=True)
    glb_path = os.path.join(folder, safe + '.glb'); py_path = os.path.join(folder, safe + '.py')
    with open(glb_path, 'wb') as f:
        f.write(glb)
    with open(py_path, 'w', encoding='utf-8') as f:
        f.write(script)
    exe = find_blender()
    if exe is None:
        return {'ok': True, 'launched': False, 'folder': folder}
    env = dict(os.environ, GREENBOX_GLB=glb_path)
    subprocess.Popen([exe, '--python', py_path], cwd=folder, env=env,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return {'ok': True, 'launched': True, 'folder': folder, 'blender': exe}


def install_claude():
    """add / update mcpServers.greenbox in Claude Desktop's config; the old file is kept as a backup"""
    path = claude_config_path()
    cfg = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            raw = f.read()
        try:
            cfg = json.loads(raw) if raw.strip() else {}
        except ValueError:
            raise RuntimeError('Claude Desktop config is not valid JSON, not touching it: %s' % path)
        shutil.copy2(path, path + '.greenbox-backup-%d' % int(time.time()))
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
    servers = cfg.setdefault('mcpServers', {})
    servers['greenbox'] = mcp_entry()
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp, path)
    return path


def write_info(port):
    _port['p'] = port
    try:
        with open(os.path.join(HERE, '.bridge.json'), 'w') as f:
            json.dump({'port': port, 'token': TOKEN, 'pid': os.getpid()}, f)
    except OSError as e:
        print('bridge: could not write .bridge.json:', e)


def make_reply(h):
    """reply(code, obj=None, body=None, ctype='application/json') for one request"""
    def reply(code, obj=None, body=None, ctype='application/json'):
        data = body if body is not None else json.dumps(obj).encode()
        h.send_response(code)
        h.send_header('Content-Type', ctype)
        h.send_header('Content-Length', str(len(data)))
        h.end_headers()
        h.wfile.write(data)
    return reply


def handle(h, method, path, reply):
    """`reply(code, obj=None, body=None, ctype=...)`. Returns False when the path is not ours."""
    if method == 'GET' and path.startswith('/poll'):
        _last_poll['t'] = time.time()
        try:
            job = _jobs.get(timeout=25)
        except queue.Empty:
            reply(204, body=b'', ctype='text/plain')
            return True
        reply(200, {'id': job['id'], 'tool': job['tool'], 'args': job['args']})
        return True
    if method == 'POST' and path == '/result':
        n = int(h.headers.get('Content-Length') or 0)
        try:
            data = json.loads(h.rfile.read(n) or b'{}')
        except ValueError:
            reply(400, {'error': 'bad json'}); return True
        w = _waiting.get(data.get('id'))
        if w is not None:
            w[1] = data; w[0].set()
        reply(200, {'ok': True})
        return True
    if method == 'GET' and path.startswith('/status'):
        now = time.time()
        acts = [{'ago': round(now - a['t'], 1), 'tool': a['tool']} for a in list(_activity)[-10:]]
        reply(200, {'claude': claude_status(), 'calls': acts, 'last_call_ago': acts[-1]['ago'] if acts else None})
        return True
    if method == 'POST' and path == '/blender':
        origin = h.headers.get('Origin') or ''
        if h.headers.get('X-Greenbox-UI') != '1' or origin not in ('http://localhost:%d' % _port['p'], 'http://127.0.0.1:%d' % _port['p']):
            reply(403, {'error': 'only the Greenbox page can do this'}); return True
        n = int(h.headers.get('Content-Length') or 0)
        try:
            req = json.loads(h.rfile.read(n) or b'{}')
            reply(200, open_in_blender(req.get('name'), base64.b64decode(req.get('glb_b64') or ''), req.get('script') or ''))
        except Exception as e:
            reply(500, {'ok': False, 'error': str(e)})
        return True
    if method == 'POST' and path == '/install-claude':
        origin = h.headers.get('Origin') or ''
        ok_origin = origin in ('http://localhost:%d' % _port['p'], 'http://127.0.0.1:%d' % _port['p'])
        if h.headers.get('X-Greenbox-UI') != '1' or not ok_origin:
            reply(403, {'error': 'only the Greenbox page can do this'}); return True
        try:
            p = install_claude()
            reply(200, {'ok': True, 'config': p, 'entry': mcp_entry()})
        except Exception as e:  # report, never crash the server
            reply(500, {'ok': False, 'error': str(e)})
        return True
    if method == 'POST' and path == '/call':
        if h.headers.get('X-Greenbox-Token') != TOKEN:
            reply(403, {'error': 'bad token'}); return True
        n = int(h.headers.get('Content-Length') or 0)
        try:
            req = json.loads(h.rfile.read(n) or b'{}')
        except ValueError:
            reply(400, {'error': 'bad json'}); return True
        if time.time() - _last_poll['t'] > 40:
            reply(503, {'ok': False, 'error': 'Greenbox is not open in a browser. Open it with Mo-Greenbox (http://localhost:…/Greenbox-Cockpit.html).'})
            return True
        jid = uuid.uuid4().hex
        _activity.append({'t': time.time(), 'tool': req.get('tool')})
        ev = threading.Event(); _waiting[jid] = [ev, None]
        _jobs.put({'id': jid, 'tool': req.get('tool'), 'args': req.get('args') or {}})
        ok = ev.wait(timeout=float(req.get('timeout') or 300))
        res = _waiting.pop(jid, [None, None])[1]
        if not ok or res is None:
            reply(504, {'ok': False, 'error': 'Greenbox did not answer in time'}); return True
        reply(200, res)
        return True
    return False
