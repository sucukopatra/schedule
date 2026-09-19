"""Tiny sync server for the weekly timetable.

Serves everything in web/ and stores the page's state as one JSON file.
  GET  /api/state  -> current state (404 until the first save)
  PUT  /api/state  -> replace state; rejected with 409 (and the current state)
                      if the incoming savedAt is older than what's stored
  GET  /healthz    -> "ok"
Standard library only. Put auth in front of it (Caddy basic_auth).
"""
import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA_DIR = os.environ.get("DATA_DIR", "/data")
WEB_DIR = os.environ.get("WEB_DIR", os.path.join(os.path.dirname(__file__), "web"))
PORT = int(os.environ.get("PORT", "8080"))
STATE_FILE = os.path.join(DATA_DIR, "state.json")
MAX_BODY = 64 * 1024
TYPES = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".ics": "text/calendar",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}
# Types that are text under the hood and want an encoding; the rest are bytes.
TEXTISH = ("application/json", "application/manifest+json", "image/svg+xml")
lock = threading.Lock()


def static_file(path):
    """Map a request path to (filename, content type) under WEB_DIR, or None.

    Only a bare filename with a known extension is served, so there are no
    directories to walk and nothing to traverse with. Dropping a new file into
    web/ is then just a deploy; it is deliberately not a server.py change,
    because that needs the container recreated and the symptom of forgetting is
    a 404 for a file index.html is happily asking for.
    """
    name = path.lstrip("/")
    if not name or name != os.path.basename(name) or name.startswith("."):
        return None
    ctype = TYPES.get(os.path.splitext(name)[1].lower())
    return (name, ctype) if ctype else None


def read_state():
    try:
        with open(STATE_FILE, "rb") as f:
            return f.read()
    except FileNotFoundError:
        return None


def write_state(obj):
    fd, tmp = tempfile.mkstemp(dir=DATA_DIR, prefix=".state-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, STATE_FILE)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


class Handler(BaseHTTPRequestHandler):
    server_version = "week/1"

    def send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        if ctype.startswith("text/") or ctype in TEXTISH:
            ctype += "; charset=utf-8"
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def error(self, code, msg):
        self.send(code, json.dumps({"error": msg}).encode())

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            path = "/index.html"
        if path == "/api/state":
            with lock:
                body = read_state()
            return self.send(200, body) if body else self.error(404, "no state saved yet")
        if path == "/healthz":
            return self.send(200, b"ok", "text/plain")
        hit = static_file(path)
        if hit:
            try:
                with open(os.path.join(WEB_DIR, hit[0]), "rb") as f:
                    return self.send(200, f.read(), hit[1])
            except OSError:
                # Missing, a directory, too long a name -- all just "not here".
                return self.error(404, "not found")
        self.error(404, "not found")

    def do_PUT(self):
        if self.path.split("?", 1)[0] != "/api/state":
            return self.error(404, "not found")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self.error(400, "Content-Length is not a number")
        if length <= 0 or length > MAX_BODY:
            return self.error(413, "body must be between 1 byte and 64 KB")
        try:
            new = json.loads(self.rfile.read(length))
        except ValueError:
            return self.error(400, "body is not valid JSON")
        if not isinstance(new, dict):
            return self.error(400, "body must be a JSON object")
        with lock:
            current = read_state()
            if current:
                try:
                    stored_at = json.loads(current).get("savedAt") or 0
                except ValueError:
                    stored_at = 0
                if (new.get("savedAt") or 0) < stored_at:
                    return self.send(409, current)
            write_state(new)
        self.send(200, json.dumps(new, ensure_ascii=False).encode("utf-8"))


if __name__ == "__main__":
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"week: serving on :{PORT}, state in {STATE_FILE}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
