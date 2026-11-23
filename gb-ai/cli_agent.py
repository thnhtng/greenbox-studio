"""Greenbox chat -> the AI command-line apps already on this computer (Claude Code `claude`, OpenAI `codex`).

The 🤖 AI panel sends what the user types here; this module runs the CLI headless (the user's own login, no API
key), with the Greenbox MCP server attached, and hands its text / tool lines back to the panel.

Mounted by bridge_server.handle under /bridge/cli/ (Greenbox-page-only: X-Greenbox-UI header + localhost Origin):
  GET  cli/status            {claude: {path, version} | null, codex: … , job: running job id | null}
  POST cli/send  {engine, text, sid?, page?, lang?, edit?}  -> {ok, job}
  GET  cli/poll?job=&from=   long poll (20 s) -> {events: [...], next, done}
                             events: {k:'text',text} {k:'tool',name,args} {k:'tool_end',ok,text} {k:'done',sid,error?}
  POST cli/stop  {job}
Works with Python 3.8+.
"""
import glob
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                     # the Greenbox Studio folder
WORK = os.path.expanduser('~/.greenbox-cli')     # neutral folder: no project hooks / CLAUDE.md get in the way
_found = {'t': 0.0, 'v': None}
_jobs = {}                                       # id -> Job
_lock = threading.Lock()

PROMPT = ('You are the assistant inside Greenbox Studio (a local browser tool: 3D rigging, vehicles, play-test maps, '
          'AI Drama, HP-bar video, SFX). The user types to you in the chat panel of the Greenbox '
          'page and watches the page while you work. Drive Greenbox with the greenbox MCP tools (gb_status first when '
          'unsure, gb_screenshot to check your work). Answer directly with plain text: it is shown in that panel. Do NOT '
          'use gb_say or gb_inbox. To switch to another tool page call gb_open {page: create | vehicle | playtest | mocap | '
          'smash | explore | drama}; if a tool says the page is reloading, wait 4 s and call it '
          'again. Never navigate with gb_run_js or gb_click, and do not use the shell, other MCP servers or project '
          'files unless edit mode is on. Keep answers short, no markdown tables. Answer in the language the user writes in.')
EDIT = (' You may also read and edit files of the Greenbox project in the current folder when the user asks for a change '
        'to the tool itself. You cannot run shell commands: after editing, tell the user in one line which files changed '
        'and that the 3D source needs a rebuild / release (python3 dev/release.py) if it applies.')


def _version(path):
    try:
        out = subprocess.run([path, '--version'], capture_output=True, text=True, timeout=8, stdin=subprocess.DEVNULL, env=_env())
        return (out.stdout or out.stderr).strip().splitlines()[0][:60]
    except Exception:
        return ''


def _env():
    e = dict(os.environ)
    for k in list(e):
        if k.startswith('CLAUDECODE') or k.startswith('CLAUDE_CODE_'):   # never look like a nested Claude Code session
            e.pop(k)
    extra = [os.path.expanduser(p) for p in ('~/.local/bin', '~/.claude/local', '~/.npm-global/bin', '~/.bun/bin')] + ['/opt/homebrew/bin', '/usr/local/bin']
    e['PATH'] = os.pathsep.join([e.get('PATH', '')] + extra)
    return e


def _which(name):
    p = shutil.which(name, path=_env()['PATH'])
    if p:
        return p
    if name == 'claude':   # the copy bundled with the Claude desktop app (newest version wins)
        pats = [os.path.expanduser('~/Library/Application Support/Claude/claude-code/*/*/claude.app/Contents/MacOS/claude'),
                os.path.expanduser('~/Library/Application Support/Claude/claude-code/*/claude'),
                os.path.join(os.environ.get('APPDATA', ''), 'Claude', 'claude-code', '*', 'claude.exe')]
        hits = []
        for pat in pats:
            hits += [h for h in glob.glob(pat) if os.access(h, os.X_OK)]

        def ver(h):
            for part in h.split(os.sep):
                bits = part.split('.')
                if len(bits) == 3 and all(b.isdigit() for b in bits):
                    return tuple(int(b) for b in bits)
            return (0, 0, 0)
        if hits:
            return sorted(hits, key=ver)[-1]
    return None


def found(force=False):
    if _found['v'] is None or force or time.time() - _found['t'] > 300:
        v = {}
        for name in ('claude', 'codex'):
            p = _which(name)
            v[name] = {'path': p, 'version': _version(p)} if p else None
        _found['v'] = v; _found['t'] = time.time()
    return _found['v']


class Job:
    def __init__(self, engine):
        self.id = uuid.uuid4().hex[:12]
        self.engine = engine
        self.events = []
        self.cond = threading.Condition()
        self.done = False
        self.proc = None
        self.sid = None
        self.t = time.time()

    def add(self, ev):
        with self.cond:
            self.events.append(ev)
            if ev.get('k') == 'done':
                self.done = True
            self.cond.notify_all()


def _short(v, n=300):
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    return s if len(s) <= n else s[:n] + '…'


def _entry():
    """the Greenbox MCP server, told to talk to THIS Greenbox server (several may run on other ports)"""
    import bridge_server   # late import: bridge_server imports this module
    e = dict(bridge_server.mcp_entry())
    e['env'] = {'GREENBOX_PORT': str(bridge_server._port['p'])}
    return e


def _mcp_file():
    e = _entry()
    os.makedirs(WORK, exist_ok=True)
    p = os.path.join(WORK, 'mcp-%s.json' % e['env']['GREENBOX_PORT'])
    with open(p, 'w', encoding='utf-8') as f:
        json.dump({'mcpServers': {'greenbox': e}}, f)
    return p


def _claude_cmd(path, text, sid, extra, edit):
    cmd = [path, '-p', text, '--output-format', 'stream-json', '--verbose',
           '--mcp-config', _mcp_file(), '--strict-mcp-config',
           '--settings', '{"disableAllHooks":true}',
           '--append-system-prompt', PROMPT + (EDIT if edit else '') + extra,
           '--disallowedTools', 'mcp__greenbox__gb_say,mcp__greenbox__gb_inbox']
    if edit:
        cmd += ['--allowedTools', 'mcp__greenbox,Read,Edit,Write,Glob,Grep', '--permission-mode', 'acceptEdits']
    else:
        cmd += ['--allowedTools', 'mcp__greenbox']
    if sid:
        cmd += ['--resume', sid]
    return cmd


def _codex_cmd(path, text, sid, extra, edit):
    e = _entry()
    opts = ['--json', '--skip-git-repo-check',
            '-c', 'mcp_servers.greenbox.command=%s' % json.dumps(e['command']),
            '-c', 'mcp_servers.greenbox.args=%s' % json.dumps(e['args']),
            '-c', 'mcp_servers.greenbox.env={GREENBOX_PORT="%s"}' % e['env']['GREENBOX_PORT'],
            '-c', 'mcp_servers.greenbox.default_tools_approval_mode="approve"']
    if sid:   # the sandbox of a resumed thread is the one it started with
        return [path, 'exec', 'resume'] + opts + [sid, text]
    return [path, 'exec'] + opts + ['-s', 'workspace-write' if edit else 'read-only', '[Greenbox] ' + PROMPT + (EDIT if edit else '') + extra + '\n\nUser: ' + text]


def _read_claude(job, line):
    try:
        j = json.loads(line)
    except ValueError:
        return
    t = j.get('type')
    if t == 'system' and j.get('subtype') == 'init':
        job.sid = j.get('session_id') or job.sid
    elif t == 'assistant':
        for c in (j.get('message') or {}).get('content') or []:
            if c.get('type') == 'text' and (c.get('text') or '').strip():
                job.add({'k': 'text', 'text': c['text']})
            elif c.get('type') == 'tool_use' and c.get('name') != 'ToolSearch':
                job.add({'k': 'tool', 'name': c.get('name', ''), 'args': _short(c.get('input') or {})})
    elif t == 'user':
        for c in (j.get('message') or {}).get('content') or []:
            if isinstance(c, dict) and c.get('type') == 'tool_result' and c.get('is_error'):
                body = c.get('content')
                if isinstance(body, list):
                    body = ' '.join(x.get('text', '') for x in body if isinstance(x, dict))
                job.add({'k': 'tool_end', 'ok': False, 'text': _short(body or '', 400)})
    elif t == 'result':
        job.sid = j.get('session_id') or job.sid
        if j.get('is_error'):
            job.err = _short(j.get('result') or j.get('subtype') or 'error', 600)


def _read_codex(job, line):
    try:
        j = json.loads(line)
    except ValueError:
        return
    t = j.get('type')
    if t == 'thread.started':
        job.sid = j.get('thread_id') or job.sid
    elif t in ('item.started', 'item.completed'):
        it = j.get('item') or {}
        kind = it.get('type')
        if kind == 'agent_message' and t == 'item.completed' and (it.get('text') or '').strip():
            job.add({'k': 'text', 'text': it['text']})
        elif kind == 'mcp_tool_call':
            if t == 'item.started':
                job.add({'k': 'tool', 'name': 'mcp__%s__%s' % (it.get('server', ''), it.get('tool', '')), 'args': _short(it.get('arguments') or {})})
            elif it.get('error') or it.get('status') == 'failed':
                job.add({'k': 'tool_end', 'ok': False, 'text': _short(it.get('error') or 'failed', 400)})
        elif kind == 'command_execution' and t == 'item.started':
            job.add({'k': 'tool', 'name': 'shell', 'args': _short(it.get('command') or '')})
        elif kind == 'file_change' and t == 'item.completed':
            job.add({'k': 'tool', 'name': 'edit', 'args': _short([c.get('path') for c in it.get('changes') or []])})
        elif kind == 'error':
            job.err = _short(it.get('message') or 'error', 600)
    elif t in ('error', 'turn.failed'):
        job.err = _short(j.get('message') or (j.get('error') or {}).get('message') or 'error', 600)


def _run(job, cmd, cwd, reader):
    job.err = None
    tail = []
    try:
        os.makedirs(cwd, exist_ok=True)
        job.proc = subprocess.Popen(cmd, cwd=cwd, env=_env(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, encoding='utf-8', errors='replace', bufsize=1, start_new_session=(os.name != 'nt'))

        def errs():
            for ln in job.proc.stderr:
                tail.append(ln.rstrip()); del tail[:-8]
        threading.Thread(target=errs, daemon=True).start()
        for line in job.proc.stdout:
            line = line.strip()
            if line.startswith('{'):
                reader(job, line)
        code = job.proc.wait()
        if code != 0 and not job.err and not getattr(job, 'stopped', False):
            job.err = 'exit %d: %s' % (code, _short(' | '.join(t for t in tail if t), 500))
    except Exception as e:   # report, never crash the server
        job.err = str(e)
    ev = {'k': 'done', 'sid': job.sid}
    if getattr(job, 'stopped', False):
        ev['stopped'] = True
    elif job.err:
        ev['error'] = job.err
    job.add(ev)


def send(req):
    engine = req.get('engine') if req.get('engine') in ('claude', 'codex') else 'claude'
    text = str(req.get('text') or '').strip()
    if not text:
        return {'ok': False, 'error': 'empty message'}
    info = found().get(engine) or found(True).get(engine)
    if not info:
        return {'ok': False, 'error': 'not-found', 'engine': engine}
    with _lock:
        for j in _jobs.values():
            if not j.done:
                return {'ok': False, 'error': 'busy', 'job': j.id}
        for k in [k for k, j in _jobs.items() if j.done and time.time() - j.t > 3600]:
            _jobs.pop(k)
        job = Job(engine); _jobs[job.id] = job
    edit = bool(req.get('edit'))
    extra = ''
    if req.get('page'):
        extra += ' The user is looking at this Greenbox page now: %s.' % _short(str(req['page']), 200)
    if req.get('lang'):
        extra += ' Interface language: %s.' % _short(str(req['lang']), 8)
    sid = str(req.get('sid') or '') or None
    if sid and not all(c.isalnum() or c in '-_' for c in sid):
        sid = None
    build = _claude_cmd if engine == 'claude' else _codex_cmd
    cmd = build(info['path'], text, sid, extra, edit)
    threading.Thread(target=_run, args=(job, cmd, ROOT if edit else WORK, _read_claude if engine == 'claude' else _read_codex), daemon=True).start()
    return {'ok': True, 'job': job.id}


def poll(job_id, start, wait=20.0):
    job = _jobs.get(job_id)
    if job is None:
        return {'events': [{'k': 'done', 'error': 'gone'}], 'next': start + 1, 'done': True}
    end = time.time() + wait
    with job.cond:
        while len(job.events) <= start and not job.done and time.time() < end:
            job.cond.wait(timeout=max(0.05, end - time.time()))
        evs = job.events[start:]
        return {'events': evs, 'next': start + len(evs), 'done': job.done and start + len(evs) >= len(job.events)}


def stop(job_id):
    job = _jobs.get(job_id)
    if job is None or job.done or job.proc is None:
        return {'ok': False}
    job.stopped = True
    try:
        if os.name != 'nt':
            os.killpg(os.getpgid(job.proc.pid), signal.SIGTERM)
        else:
            job.proc.terminate()
    except Exception:
        pass
    return {'ok': True}


def status():
    v = dict(found())
    v['job'] = next((j.id for j in _jobs.values() if not j.done), None)
    return v


def handle(h, method, path, reply, ui_ok):
    """path starts with /cli/ . `ui_ok` = the request comes from the Greenbox page (header + Origin checked by the caller)."""
    if not ui_ok:
        reply(403, {'error': 'only the Greenbox page can do this'}); return True
    q = {}
    if '?' in path:
        path, qs = path.split('?', 1)
        for kv in qs.split('&'):
            k, _, v = kv.partition('=')
            q[k] = v
    if method == 'GET' and path == '/cli/status':
        reply(200, status()); return True
    if method == 'GET' and path == '/cli/poll':
        try:
            start = max(0, int(q.get('from') or 0))
        except ValueError:
            start = 0
        reply(200, poll(q.get('job') or '', start)); return True
    if method == 'POST' and path in ('/cli/send', '/cli/stop'):
        n = int(h.headers.get('Content-Length') or 0)
        try:
            req = json.loads(h.rfile.read(n) or b'{}')
        except ValueError:
            reply(400, {'error': 'bad json'}); return True
        reply(200, send(req) if path == '/cli/send' else stop(str(req.get('job') or ''))); return True
    return False


if __name__ == '__main__':   # quick check from a terminal: python3 cli_agent.py claude "xin chào"
    sys.path.insert(0, HERE)
    print(json.dumps(found(), indent=1))
    if len(sys.argv) > 2:
        r = send({'engine': sys.argv[1], 'text': sys.argv[2]})
        print(r)
        i = 0
        while r.get('ok'):
            p = poll(r['job'], i, 5)
            for ev in p['events']:
                print(ev)
            i = p['next']
            if p['done']:
                break
