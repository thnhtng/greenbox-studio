#!/usr/bin/env python3
"""Greenbox MCP server (stdio). Lets Claude Desktop / Cowork / any MCP client drive Greenbox 3D:
look at the 3D view, open tabs, auto-rig, move joints, finish, export to files on disk, load files from disk.

Setup (Claude Desktop -> Settings -> Developer -> Edit config, claude_desktop_config.json):
  {"mcpServers": {"greenbox": {"command": "python3", "args": ["/FULL/PATH/Greenbox/gb-ai/greenbox_mcp.py"]}}}
Then open Greenbox with Mo-Greenbox (the browser tab must stay open: the tools run inside it).

Standard library only (Python 3.8+). The tool list comes from tools.json (generated from tools.js), so the
in-app AI chat and this server always offer the same actions.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PROTOCOL = '2024-11-05'


def load_tools():
    with open(os.path.join(HERE, 'tools.json'), encoding='utf-8') as f:
        tools = json.load(f)
    out = []
    for t in tools:
        schema = json.loads(json.dumps(t['input_schema']))
        props = schema.setdefault('properties', {})
        if t['name'] == 'gb_load_file':  # from MCP: read the file from disk here
            props.pop('data_b64', None); props.pop('name', None)
            props['path'] = {'type': 'string', 'description': 'absolute path of the file on this computer (GLB/FBX model, or MP4/MOV video for mocap)'}
            schema['required'] = ['page', 'path']
        if t['name'] == 'gb_export':
            props['save_to'] = {'type': 'string', 'description': 'absolute path (folder or file) to save the export to; default: the Greenbox folder/exports'}
        out.append({'name': t['name'], 'description': t['description'], 'inputSchema': schema})
    return out


def bridge():
    p = os.path.join(HERE, '.bridge.json')
    if not os.path.exists(p):
        raise RuntimeError('Greenbox is not running. Double-click Mo-Greenbox, then try again.')
    with open(p) as f:
        return json.load(f)


def call_greenbox(tool, args, timeout=300):
    info = bridge()
    req = urllib.request.Request(
        'http://127.0.0.1:%d/bridge/call' % info['port'],
        data=json.dumps({'tool': tool, 'args': args, 'timeout': timeout}).encode(),
        headers={'Content-Type': 'application/json', 'X-Greenbox-Token': info['token'], 'Host': 'localhost'},
        method='POST')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # never through a proxy: it is localhost
    try:
        with opener.open(req, timeout=timeout + 10) as r:
            res = json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            res = json.loads(e.read() or b'{}')
        except ValueError:
            res = {'ok': False, 'error': 'HTTP %d' % e.code}
    except urllib.error.URLError as e:
        raise RuntimeError('Greenbox is not running (%s). Double-click Mo-Greenbox, then try again.' % e.reason)
    if not res.get('ok'):
        raise RuntimeError(res.get('error') or 'Greenbox error')
    return res.get('result') or {}


def run_tool(name, args):
    args = dict(args or {})
    if name == 'gb_load_file':
        path = os.path.expanduser(args.pop('path', ''))
        with open(path, 'rb') as f:
            args['data_b64'] = base64.b64encode(f.read()).decode()
        args['name'] = os.path.basename(path)
    save_to = args.pop('save_to', None) if name == 'gb_export' else None
    res = call_greenbox(name, args)
    content = []
    if res.get('file'):
        fname = res['file']['name']
        target = os.path.expanduser(save_to) if save_to else os.path.join(os.path.dirname(HERE), 'exports')
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
                          'capabilities': {'tools': {}}, 'serverInfo': {'name': 'greenbox', 'version': '1.0'}}
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
