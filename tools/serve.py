"""
Local development server for the Study Planner.

    python tools/serve.py          then open http://localhost:8765
    python tools/serve.py 9000     to use a different port

Works like `python -m http.server`, except it tells the browser never to cache
anything. That way an edited .js or .css file shows up on a normal refresh,
instead of the browser quietly running the old copy.

You don't need a server at all to *use* the site (opening index.html directly
works). This is only for convenience while editing.
"""

import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

# The website folder is the parent of this tools/ folder.
SITE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


handler = functools.partial(NoCacheHandler, directory=SITE_DIR)
print(f"Serving {SITE_DIR} at http://localhost:{PORT}  (Ctrl+C to stop)")
http.server.ThreadingHTTPServer(("", PORT), handler).serve_forever()
