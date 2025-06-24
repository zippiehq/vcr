#!/usr/bin/env python3
"""
Simple HTTP server with health endpoint
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
from datetime import datetime

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            response = {
                'status': 'OK',
                'timestamp': datetime.utcnow().isoformat(),
                'service': 'sample-python',
                'version': '1.0.0'
            }
            
            self.wfile.write(json.dumps(response, indent=2).encode())
        else:
            self.send_response(404)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'Not Found')

def run_server(port=8080):
    server_address = ('', port)
    httpd = HTTPServer(server_address, HealthHandler)
    print(f'Starting server on port {port}...')
    print(f'Health endpoint available at: http://localhost:{port}/health')
    httpd.serve_forever()

if __name__ == '__main__':
    # Get port from environment variable or use default
    port = int(os.environ.get('PORT', 8080))
    run_server(port) 