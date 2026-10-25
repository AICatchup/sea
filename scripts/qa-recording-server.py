"""Explicit local QA recording destination. Bind only to loopback; never overwrite.
Usage: python scripts/qa-recording-server.py NEW_OR_EXISTING_OUTPUT_DIRECTORY
Open the Vite preview with waverecord=1&capturestore=1. Stop after verification.
"""
import hashlib
import json
import sys
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

root = Path(sys.argv[1]).resolve(strict=True)
if not root.is_dir():
    raise SystemExit("Recording destination must already be a directory")
origins = {"http://127.0.0.1:5200", "http://localhost:5200"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)

    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin in origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.headers.get("Host") != "127.0.0.1:5201":
            self.send_error(403)
            return
        super().do_GET()

    def do_HEAD(self):
        if self.headers.get("Host") != "127.0.0.1:5201":
            self.send_error(403)
            return
        super().do_HEAD()

    def do_OPTIONS(self):
        if self.path != "/recordings" or self.headers.get("Origin") not in origins:
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if (self.path != "/recordings" or self.headers.get("Origin") not in origins
                or self.headers.get("Host") != "127.0.0.1:5201"
                or self.headers.get("Content-Type") != "application/json"):
            self.send_error(403)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 2 <= size <= 200 * 1024 * 1024:
            self.send_error(413)
            return
        self.connection.settimeout(120)
        name = datetime.now(timezone.utc).strftime("capture-%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8] + ".json"
        target = root / name
        remaining = size
        digest = hashlib.sha256()
        # A truncated upload is preserved for diagnosis, never labelled successful.
        with target.open("xb") as stream:
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise ConnectionError("Incomplete capture")
                stream.write(chunk)
                digest.update(chunk)
                remaining -= len(chunk)
        body = json.dumps({"file": name, "bytes": size, "sha256": digest.hexdigest()}).encode("utf-8")
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


ThreadingHTTPServer(("127.0.0.1", 5201), Handler).serve_forever()
