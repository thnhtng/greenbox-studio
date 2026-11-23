"""Greenbox MCP bridge (server side, mounted by serve.py under /bridge).

  POST /bridge/call    {tool, args}  -> waits for the browser to run it -> {ok, result | error}
                       needs header X-Greenbox-Token (written to gb-ai/.bridge.json at start: only local
                       programs that can read that file, i.e. greenbox_mcp.py, can drive Greenbox)
  GET  /bridge/poll    the Greenbox cockpit waits here for the next call (long poll)
  POST /bridge/result  the cockpit returns the result of a call
  GET  /bridge/status  what the AI side looks like (MCP calls seen, Claude Desktop config found / set up)
  POST /bridge/blender {name, glb_b64, script}   saves a Rigify kit into Greenbox/exports/ and opens it in
                       Blender (same Greenbox-page-only rule as install-claude)
  POST /bridge/save?name=…   raw file body from the Greenbox page (big exports: cockpit .MOV alpha, MP4) -> written to
                       Greenbox/exports/drive/<name>; replies {ok, path}. Greenbox-page-only, like /blender. Big files no
                       longer travel as base64 inside an MCP reply (that timed out / dropped the bridge)
  POST /bridge/install-claude | install-codex | install-claude-code   adds Greenbox to Claude Desktop's /
                       Codex's (~/.codex/config.toml) / Claude Code's (~/.claude.json) MCP config (backup first). Only from the
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
_clients = {}  # browser page id -> time of its last /poll
_pref = {'c': None}  # the page the user last chatted from: MCP calls go to it while it is open

try:
    import cli_agent
except Exception:  # the chat-to-CLI bridge is optional
    cli_agent = None


def ui_ok(h):
    """the request comes from the Greenbox page itself (header a plain web page cannot send cross-site + localhost Origin)"""
    origin = h.headers.get('Origin') or ''
    ok_origin = origin in ('', 'http://localhost:%d' % _port['p'], 'http://127.0.0.1:%d' % _port['p'])
    return h.headers.get('X-Greenbox-UI') == '1' and ok_origin


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


def codex_config_path():
    """Codex (CLI / app) keeps its MCP servers in ~/.codex/config.toml (CODEX_HOME if set)"""
    return os.path.join(os.environ.get('CODEX_HOME') or os.path.expanduser('~/.codex'), 'config.toml')


def claude_code_config_path():
    """Claude Code's user-wide MCP servers live in ~/.claude.json (mcpServers)"""
    return os.path.expanduser('~/.claude.json')


def _toml_str(v):
    return '"' + str(v).replace('\\', '\\\\').replace('"', '\\"') + '"'


def _codex_block():
    e = mcp_entry()
    return '[mcp_servers.greenbox]\ncommand = %s\nargs = [%s]\n' % (_toml_str(e['command']), ', '.join(_toml_str(a) for a in e['args']))


def _strip_codex_block(text):
    """the config without its [mcp_servers.greenbox] table (and its sub-tables)"""
    out, skip = [], False
    for line in text.splitlines(keepends=True):
        t = line.strip()
        if t.startswith('['):
            name = t.strip('[]').strip()
            skip = name == 'mcp_servers.greenbox' or name.startswith('mcp_servers.greenbox.')
        if not skip:
            out.append(line)
    return ''.join(out)


def codex_status():
    path = codex_config_path()
    out = {'config': path, 'app_found': os.path.isdir(os.path.dirname(path)) or bool(shutil.which('codex')), 'installed': False}
    try:
        with open(path, encoding='utf-8') as f:
            txt = f.read()
        out['installed'] = '[mcp_servers.greenbox]' in txt and mcp_entry()['args'][0] in txt.replace('\\\\', '\\')
    except OSError:
        pass
    return out


def install_codex():
    """add / update [mcp_servers.greenbox] in Codex's config.toml; the old file is kept as a backup"""
    path = codex_config_path()
    txt = ''
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            txt = f.read()
        shutil.copy2(path, path + '.greenbox-backup-%d' % int(time.time()))
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
    txt = _strip_codex_block(txt).rstrip('\n')
    txt = (txt + '\n\n' if txt else '') + _codex_block()
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(txt)
    os.replace(tmp, path)
    return path


def claude_code_status():
    path = claude_code_config_path()
    out = {'config': path, 'app_found': os.path.exists(path) or bool(shutil.which('claude')), 'installed': False}
    try:
        with open(path, encoding='utf-8') as f:
            g = (json.load(f).get('mcpServers') or {}).get('greenbox')
        out['installed'] = bool(g) and os.path.abspath((g.get('args') or [''])[-1]) == os.path.abspath(mcp_entry()['args'][0])
    except (OSError, ValueError, AttributeError):
        pass
    return out


def install_claude_code():
    """add / update the user-wide mcpServers.greenbox in ~/.claude.json (Claude Code); backup first"""
    path = claude_code_config_path()
    cfg = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            raw = f.read()
        try:
            cfg = json.loads(raw) if raw.strip() else {}
        except ValueError:
            raise RuntimeError('~/.claude.json is not valid JSON, not touching it')
        shutil.copy2(path, path + '.greenbox-backup-%d' % int(time.time()))
    cfg.setdefault('mcpServers', {})['greenbox'] = dict(mcp_entry(), type='stdio')
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp, path)
    return path


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


def _alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def _write(path, info):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(info, f)
    os.replace(tmp, path)


def write_info(port):
    """.bridge.json = the server the MCP talks to; .bridge-<port>.json = this server too, so a 2nd Greenbox server
    (another port) never strands the MCP: when the server named in .bridge.json stops, a live one takes it back."""
    _port['p'] = port
    info = {'port': port, 'token': TOKEN, 'pid': os.getpid()}
    try:
        _write(os.path.join(HERE, '.bridge-%d.json' % port), info)
        if os.environ.get('GREENBOX_SIDE'):   # a side / test server: outside AI apps keep talking to the main one
            return
        _write(os.path.join(HERE, '.bridge.json'), info)
    except OSError as e:
        print('bridge: could not write .bridge.json:', e)

    def heal():
        main = os.path.join(HERE, '.bridge.json')
        while True:
            time.sleep(5)
            try:
                with open(main) as f:
                    cur = json.load(f)
                if cur.get('pid') == os.getpid() or _alive(cur.get('pid')):
                    continue
            except (OSError, ValueError):
                pass
            try:
                _write(main, info)
                print('bridge: .bridge.json pointed at a stopped server, now this one (port %d)' % port)
            except OSError:
                pass
    threading.Thread(target=heal, daemon=True).start()


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


def _gone(h):
    """True when the browser closed this connection (page reloaded or left)."""
    try:
        import select, socket
        sock = h.connection
        if not select.select([sock], [], [], 0)[0]:
            return False
        return sock.recv(1, socket.MSG_PEEK) == b''
    except Exception:
        return True


def handle(h, method, path, reply):
    """`reply(code, obj=None, body=None, ctype=...)`. Returns False when the path is not ours."""
    if path.startswith('/cli/'):
        if cli_agent is None:
            reply(404, {'error': 'cli_agent.py missing'}); return True
        if method == 'POST' and path == '/cli/send' and ui_ok(h):
            c = h.headers.get('X-Greenbox-Client')
            if c:
                _pref['c'] = c
        return cli_agent.handle(h, method, path, reply, ui_ok(h))
    if method == 'GET' and path.startswith('/poll'):
        _last_poll['t'] = time.time()
        c = path.partition('c=')[2].split('&')[0] or None
        if c:
            _clients[c] = time.time()
        # several Greenbox pages open: tool calls go to the one the user chats from (while it keeps polling)
        if _pref['c'] and c != _pref['c'] and time.time() - _clients.get(_pref['c'], 0) < 40:
            time.sleep(8)
            reply(204, body=b'', ctype='text/plain')
            return True
        # wait in short slices and give up when the page went away (reload / page change): a call handed to a dead
        # connection would be lost and the AI would wait for nothing
        job, end = None, time.time() + (8 if c else 25)
        while job is None and time.time() < end:
            if _gone(h):
                return True
            try:
                job = _jobs.get(timeout=0.5)
            except queue.Empty:
                pass
        if job is None:
            reply(204, body=b'', ctype='text/plain')
            return True
        if _gone(h):
            _jobs.put(job)
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
        reply(200, {'claude': claude_status(), 'codex': codex_status(), 'claude_code': claude_code_status(), 'calls': acts, 'last_call_ago': acts[-1]['ago'] if acts else None})
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
    if method == 'POST' and path.startswith('/save'):
        origin = h.headers.get('Origin') or ''
        if h.headers.get('X-Greenbox-UI') != '1' or origin not in ('http://localhost:%d' % _port['p'], 'http://127.0.0.1:%d' % _port['p']):
            reply(403, {'error': 'only the Greenbox page can do this'}); return True
        try:
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(path).query)
            name = os.path.basename((q.get('name') or ['export.bin'])[0]) or 'export.bin'
            name = ''.join(ch for ch in name if ch.isalnum() or ch in '-_.') or 'export.bin'
            sub = ''.join(ch for ch in (q.get('dir') or ['drive'])[0] if ch.isalnum() or ch in '-_') or 'drive'
            folder = os.path.join(os.path.dirname(HERE), 'exports', sub)
            os.makedirs(folder, exist_ok=True)
            target = os.path.join(folder, name)
            n = int(h.headers.get('Content-Length') or 0)
            with open(target + '.part', 'wb') as f:
                left = n
                while left > 0:
                    chunk = h.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    f.write(chunk); left -= len(chunk)
            if left:
                raise RuntimeError('upload cut short (%d bytes missing)' % left)
            os.replace(target + '.part', target)
            reply(200, {'ok': True, 'path': target, 'bytes': n})
        except Exception as e:
            reply(500, {'ok': False, 'error': str(e)})
        return True
    if method == 'POST' and path in ('/install-claude', '/install-codex', '/install-claude-code'):
        origin = h.headers.get('Origin') or ''
        ok_origin = origin in ('http://localhost:%d' % _port['p'], 'http://127.0.0.1:%d' % _port['p'])
        if h.headers.get('X-Greenbox-UI') != '1' or not ok_origin:
            reply(403, {'error': 'only the Greenbox page can do this'}); return True
        try:
            p = {'/install-claude': install_claude, '/install-codex': install_codex, '/install-claude-code': install_claude_code}[path]()
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
