#!/usr/bin/env python3
"""Static server for this repo plus a POST /__save/<name> endpoint.

Only used by tools/generate-loop.html?save=1 so a re-rendered loop can be
written straight into assets/audio/ without a browser download. Every other
page in this repo runs on any plain static server.

    python3 tools/save-server.py 8000 .
    open http://127.0.0.1:8000/index.html
"""
import http.server, os, sys, socketserver
ROOT = sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**k): super().__init__(*a, directory=ROOT, **k)
    def do_POST(self):
        if self.path.startswith('/__save/'):
            name = os.path.basename(self.path[len('/__save/'):])
            n = int(self.headers.get('Content-Length','0'))
            data = self.rfile.read(n)
            dest = os.path.join(ROOT, 'assets', 'audio', name)
            with open(dest,'wb') as f: f.write(data)
            self.send_response(200); self.send_header('Content-Length','2'); self.end_headers(); self.wfile.write(b'ok')
            print('saved', dest, len(data), flush=True)
        else:
            self.send_error(404)
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin','*')
        super().end_headers()
socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('127.0.0.1', int(sys.argv[1])), H) as httpd:
    httpd.serve_forever()
