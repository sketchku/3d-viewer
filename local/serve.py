"""Local dev server with no-cache headers and CAD-to-STEP conversion API."""
from __future__ import annotations

import os
import sys

from viewer_server import serve

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
HOST = '127.0.0.1'

if __name__ == '__main__':
    # Serve the web app from the project root (parent of local/).
    directory = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    serve(directory, HOST, PORT)