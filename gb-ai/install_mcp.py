#!/usr/bin/env python3
"""Greenbox MCP setup (run by install.sh / install.ps1, or by hand):  python3 install_mcp.py
Adds the server in this folder (greenbox_mcp.py) to every AI app found on this computer, old files backed up:
  Claude Desktop  claude_desktop_config.json  mcpServers.greenbox
  Codex           ~/.codex/config.toml        [mcp_servers.greenbox]   (only that table is rewritten)
  Claude Code     ~/.claude.json              mcpServers.greenbox
Standard library only (Python 3.8+)."""
import json
import os
import platform
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ENTRY = {'command': sys.executable or 'python3', 'args': [os.path.join(HERE, 'greenbox_mcp.py')]}
STAMP = '.greenbox-backup-%d' % int(time.time())


def backup(path):
    if os.path.exists(path):
        shutil.copy2(path, path + STAMP)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
    os.replace(tmp, path)


def json_app(path, extra=None):
    cfg = {}
    if os.path.exists(path):
        raw = open(path, encoding='utf-8').read()
        try:
            cfg = json.loads(raw) if raw.strip() else {}
        except ValueError:
            return 'not valid JSON, left alone: ' + path
    backup(path)
    cfg.setdefault('mcpServers', {})['greenbox'] = dict(ENTRY, **(extra or {}))
    write(path, json.dumps(cfg, indent=2))
    return 'ok'


def claude_desktop():
    s = platform.system()
    if s == 'Darwin':
        p = os.path.expanduser('~/Library/Application Support/Claude/claude_desktop_config.json')
    elif s == 'Windows':
        p = os.path.join(os.environ.get('APPDATA') or os.path.expanduser('~\\AppData\\Roaming'), 'Claude', 'claude_desktop_config.json')
    else:
        p = os.path.expanduser('~/.config/Claude/claude_desktop_config.json')
    if not os.path.isdir(os.path.dirname(p)):
        return None  # not installed
    return json_app(p)


def toml_str(v):
    return '"' + str(v).replace('\\', '\\\\').replace('"', '\\"') + '"'


def codex():
    home = os.environ.get('CODEX_HOME') or os.path.expanduser('~/.codex')
    if not os.path.isdir(home) and not shutil.which('codex'):
        return None
    p = os.path.join(home, 'config.toml')
    txt = open(p, encoding='utf-8').read() if os.path.exists(p) else ''
    backup(p)
    out, skip = [], False
    for line in txt.splitlines(keepends=True):  # drop the old greenbox table and its sub-tables only
        t = line.strip()
        if t.startswith('['):
            name = t.strip('[]').strip()
            skip = name == 'mcp_servers.greenbox' or name.startswith('mcp_servers.greenbox.')
        if not skip:
            out.append(line)
    body = ''.join(out).rstrip('\n')
    block = '[mcp_servers.greenbox]\ncommand = %s\nargs = [%s]\n' % (toml_str(ENTRY['command']), ', '.join(toml_str(a) for a in ENTRY['args']))
    write(p, (body + '\n\n' if body else '') + block)
    return 'ok'


def claude_code():
    p = os.path.expanduser('~/.claude.json')
    if not os.path.exists(p) and not shutil.which('claude'):
        return None
    return json_app(p, {'type': 'stdio'})


def main():
    if not os.path.exists(ENTRY['args'][0]):
        print('greenbox_mcp.py is missing next to this file: ' + HERE); sys.exit(1)
    done = []
    for name, fn in (('Claude Desktop', claude_desktop), ('Codex', codex), ('Claude Code', claude_code)):
        try:
            r = fn()
        except Exception as e:  # report, keep going with the other apps
            r = 'error: %s' % e
        if r is None:
            print('  ·  %-15s không có trên máy này / not on this computer' % name)
        elif r == 'ok':
            print('  ✅ %-15s đã gắn Greenbox / Greenbox added' % name); done.append(name)
        else:
            print('  ⚠  %-15s %s' % (name, r))
    print()
    if not done:
        print('Không thấy app AI nào. Cài Claude Desktop, Codex hoặc Claude Code rồi chạy lại lệnh này.')
        print('No AI app found. Install Claude Desktop, Codex or Claude Code, then run this again.')
        return
    print('Xong! Bước tiếp theo / Next:')
    print('  1. Tắt hẳn rồi mở lại: ' + ', '.join(done) + '   (quit completely and reopen)')
    print('  2. Mở Greenbox trên trình duyệt, rồi nhắn cho AI: "kết nối Greenbox"   (ask: "connect to Greenbox")')
    print('  3. AI đưa mã 6 số → nhập vào Greenbox: 🤖 AI → ⚙ → Mã ghép nối   (type the 6-digit code in Greenbox)')


if __name__ == '__main__':
    main()
