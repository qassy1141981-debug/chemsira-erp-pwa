from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class AppHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlsplit(self.path)
        path = parsed.path
        app_prefix = "/alsafa-accounting"
        if path == app_prefix:
            path = f"{app_prefix}/"
        if path.startswith(f"{app_prefix}/"):
            path = path[len(app_prefix) :]
        self.path = path + (f"?{parsed.query}" if parsed.query else "")

        requested = self.translate_path(path)
        if not Path(requested).is_file() and "text/html" in self.headers.get("Accept", ""):
            self.path = "/index.html"
        super().do_GET()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 5000), AppHandler).serve_forever()
