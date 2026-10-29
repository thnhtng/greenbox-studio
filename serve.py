# Greenbox local server: like `python3 -m http.server`, but tells the browser never to cache,
# so a freshly unzipped update always shows up without clearing Safari/Chrome caches.
# It also hosts the MCP bridge under /bridge (gb-ai/), so AI apps can drive Greenbox from this one window.
import http.server, socketserver, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

try:
    sys.path.insert(0, os.path.join(HERE, 'gb-ai'))
    import bridge_server as bridge
except Exception as e:  # Greenbox still works without the MCP bridge
    bridge = None
    print('MCP bridge unavailable:', e)


class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and '/bridge/' in str(args[0]):
            return
        super().log_message(fmt, *args)

    def _local_only(self, reply):
        host = (self.headers.get('Host') or '').split(':')[0]
        if self.client_address[0] not in ('127.0.0.1', '::1', '::ffff:127.0.0.1') or host not in ('localhost', '127.0.0.1'):
            reply(403, {'error': 'only answers this computer (open Greenbox at http://localhost)'})
            return False
        return True

    def _bridge(self, method):
        if bridge is None or not self.path.startswith('/bridge/'):
            return False
        reply = bridge.make_reply(self)
        if self._local_only(reply) and not bridge.handle(self, method, self.path[len('/bridge'):], reply):
            reply(404, {'error': 'not found'})
        return True

    def do_GET(self):
        if not self._bridge('GET'):
            super().do_GET()

    def do_POST(self):
        if not self._bridge('POST'):
            self.send_error(405)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True   # Ctrl+C must not wait for open connections (the cockpit keeps a 25 s long-poll open)
    block_on_close = False

    def handle_error(self, request, client_address):
        # Browsers routinely cancel an old 4.5 MB cockpit response during reload/navigation. That is normal,
        # not a server failure, so keep the launcher window clean instead of printing a scary traceback.
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


httpd = Server(('', PORT), H)
print(f'Greenbox dang chay tai http://localhost:{PORT}  (Ctrl+C hoac dong cua so nay de tat)')
if bridge is not None:
    bridge.write_info(PORT)
    print('MCP bridge: san sang (gb-ai/greenbox_mcp.py)')
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    httpd.server_close()
    print('\nGreenbox da tat.')
