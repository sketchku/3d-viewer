"""HTTP server: static files + CAD-to-STEP conversion API."""
from __future__ import annotations

import cgi
import http.server
import json
import os
import socketserver
import sys
import tempfile
import urllib.parse
from pathlib import Path

from cad_converter import (
    ConversionError,
    can_convert_ext,
    convert_to_step,
    detect_backends,
    get_app_key,
    get_convert_backends_for_ext,
)

MAX_UPLOAD_BYTES = 500 * 1024 * 1024


def make_handler(directory: str):
    class ViewerHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)

        def end_headers(self):
            if self.path.endswith(('.html', '.js', '.css', '.mjs')):
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
            super().end_headers()

        def do_GET(self):
            if self.path.split('?', 1)[0] == '/api/convert-step/status':
                self._send_convert_status()
                return
            super().do_GET()

        def do_POST(self):
            if self.path.split('?', 1)[0] == '/api/convert-step':
                self._handle_convert_step()
                return
            self.send_error(404)

        def _send_convert_status(self):
            backends = detect_backends()
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            ext = (qs.get('ext') or [''])[0].lower().lstrip('.')

            payload: dict = {
                'available': len(backends) > 0,
                'backends': backends,
            }
            if ext and get_app_key(ext):
                convert_backends = get_convert_backends_for_ext(ext, backends)
                payload['ext'] = ext
                payload['canConvert'] = len(convert_backends) > 0
                payload['convertBackends'] = convert_backends

            body = json.dumps(payload).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _handle_convert_step(self):
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0 or length > MAX_UPLOAD_BYTES:
                self._json_error(400, 'Invalid upload size')
                return

            try:
                form = cgi.FieldStorage(
                    fp=self.rfile,
                    headers=self.headers,
                    environ={
                        'REQUEST_METHOD': 'POST',
                        'CONTENT_TYPE': self.headers.get('Content-Type', ''),
                        'CONTENT_LENGTH': str(length),
                    },
                )
            except Exception as exc:
                self._json_error(400, f'Bad form data: {exc}')
                return

            if 'file' not in form:
                self._json_error(400, 'Missing file field')
                return

            item = form['file']
            if not getattr(item, 'file', None) or not getattr(item, 'filename', None):
                self._json_error(400, 'Empty upload')
                return

            filename = os.path.basename(item.filename)
            ext = (form.getvalue('ext') or Path(filename).suffix.lstrip('.')).lower()
            if not get_app_key(ext):
                self._json_error(400, f'Extension not convertible: {ext}')
                return
            if not can_convert_ext(ext):
                self._json_error(
                    422,
                    'No converter available for this file type. '
                    'Install the matching CAD app or FreeCAD, or export STEP manually.',
                )
                return

            tmp_in = None
            tmp_out = None
            try:
                with tempfile.NamedTemporaryFile(delete=False, suffix=f'.{ext}') as tmp:
                    tmp_in = tmp.name
                    data = item.file.read()
                    if not data:
                        raise ConversionError('Empty file')
                    tmp.write(data)

                tmp_out = convert_to_step(tmp_in, ext)
                with open(tmp_out, 'rb') as handle:
                    out_data = handle.read()

                out_name = f'{Path(filename).stem}.stp'
                self.send_response(200)
                self.send_header('Content-Type', 'application/step')
                self.send_header('Content-Disposition', f'attachment; filename="{out_name}"')
                self.send_header('Content-Length', str(len(out_data)))
                self.send_header('X-Converted-From', ext)
                self.end_headers()
                self.wfile.write(out_data)
            except ConversionError as exc:
                self._json_error(422, str(exc))
            except Exception as exc:
                self._json_error(500, str(exc))
            finally:
                for path in (tmp_in, tmp_out):
                    if path and os.path.isfile(path):
                        try:
                            os.remove(path)
                        except OSError:
                            pass

        def _json_error(self, code: int, message: str):
            body = json.dumps({'error': message}).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            sys.stdout.write('%s - %s\n' % (self.address_string(), format % args))

    return ViewerHandler


def serve(directory: str, host: str = '127.0.0.1', port: int = 8080):
    handler = make_handler(directory)
    with socketserver.TCPServer((host, port), handler) as httpd:
        httpd.allow_reuse_address = True
        print(f'Serving {directory} at http://{host}:{port}/')
        httpd.serve_forever()