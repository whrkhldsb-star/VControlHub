function pythonStringLiteral(value: string) {
  return JSON.stringify(value);
}

export function sanitizeFileProxyOrigin(value: string | null) {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function buildFileProxyScript(input: {
  accessToken: string;
  expiresAtMs: number;
  serveDir: string;
  port: number;
  allowedOrigin: string;
}) {
  // Generated on the target VPS. Keep all untrusted values JSON-quoted so paths,
  // tokens, and origins cannot break out of the Python source.
  return `
import http.server
import os
import posixpath
import time
import urllib.parse

TOKEN = ${pythonStringLiteral(input.accessToken)}
EXPIRES_AT_MS = ${input.expiresAtMs}
SERVE_DIR = ${pythonStringLiteral(input.serveDir)}
ALLOWED_ORIGIN = ${pythonStringLiteral(input.allowedOrigin)}

class AuthHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "VControlHubFileProxy/2.0"

    def _send_plain(self, code, message):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(message.encode("utf-8"))

    def _origin_allowed(self):
        origin = self.headers.get("Origin", "")
        return not origin or not ALLOWED_ORIGIN or origin == ALLOWED_ORIGIN

    def _request_token(self):
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        header_token = self.headers.get("X-VControlHub-Proxy-Token", "")
        if header_token:
            return header_token.strip()
        # Temporary backward-compatible fallback for older clients. New callers
        # should use Authorization or X-VControlHub-Proxy-Token so secrets are
        # not copied into URLs, browser history, proxy logs, or Referer headers.
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        return query.get("token", [""])[0]

    def _validate(self):
        if int(time.time() * 1000) > EXPIRES_AT_MS:
            return None, (410, "Gone: token expired")
        if self._request_token() != TOKEN:
            return None, (403, "Forbidden: invalid token")
        if not self._origin_allowed():
            return None, (403, "Forbidden: origin not allowed")
        parsed = urllib.parse.urlparse(self.path)
        normalized = posixpath.normpath("/" + urllib.parse.unquote(parsed.path).lstrip("/"))
        if normalized.startswith("/../") or normalized == "/..":
            return None, (400, "invalid path")
        root_real = os.path.realpath(SERVE_DIR)
        target = os.path.realpath(os.path.join(root_real, normalized.lstrip("/")))
        if target != root_real and not target.startswith(root_real + os.sep):
            return None, (400, "path outside serve root")
        return target, None

    def do_GET(self):
        target, error = self._validate()
        if error:
            return self._send_plain(*error)
        if not os.path.isfile(target):
            return self._send_plain(404, "not found")
        self.path = "/" + os.path.relpath(target, SERVE_DIR).replace(os.sep, "/")
        return super().do_GET()

    def do_HEAD(self):
        return self.do_GET()

    def translate_path(self, path):
        parsed = urllib.parse.urlparse(path)
        normalized = posixpath.normpath("/" + urllib.parse.unquote(parsed.path).lstrip("/"))
        root_real = os.path.realpath(SERVE_DIR)
        target = os.path.realpath(os.path.join(root_real, normalized.lstrip("/")))
        if target != root_real and not target.startswith(root_real + os.sep):
            return root_real
        return target

    def end_headers(self):
        origin = self.headers.get("Origin", "")
        if origin and ALLOWED_ORIGIN and origin == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, X-VControlHub-Proxy-Token")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_OPTIONS(self):
        if not self._origin_allowed():
            return self._send_plain(403, "Forbidden: origin not allowed")
        self.send_response(204)
        self.end_headers()

port = ${input.port || 0}
os.chdir(SERVE_DIR)
with http.server.ThreadingHTTPServer(("0.0.0.0", port), AuthHandler) as httpd:
    actual_port = httpd.server_address[1]
    print(f"PROXY_READY:{actual_port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
`.trim();
}
