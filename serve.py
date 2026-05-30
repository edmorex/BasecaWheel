#!/usr/bin/env python3
import http.server
import socketserver
import os
import json
import webbrowser

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")


def build_image_manifest():
    """Scan images/ and write a manifest.json the gallery can fetch.
    Regenerated on every startup so newly added images appear automatically."""
    images_dir = os.path.join(DIRECTORY, "images")
    if not os.path.isdir(images_dir):
        return
    names = sorted(
        f for f in os.listdir(images_dir)
        if f.lower().endswith(IMAGE_EXTS)
    )
    with open(os.path.join(images_dir, "manifest.json"), "w") as fh:
        json.dump(names, fh, indent=2)
    print(f"Image manifest: {len(names)} images")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        print(f"  {self.address_string()} - {format % args}")


build_image_manifest()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    url = f"http://localhost:{PORT}/BasecaWheel.html"
    print(f"Serving at {url}")
    print("Press Ctrl+C to stop.\n")
    webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
