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
import hashlib
import hmac
import http.server
import os
import posixpath
import sys
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

    def _token_matches(self, provided):
        # Hash both sides so hmac.compare_digest always runs on equal-length
        # digests (avoids length-leaking early exits and non-constant !=).
        expected = hashlib.sha256(TOKEN.encode("utf-8")).digest()
        actual = hashlib.sha256((provided or "").encode("utf-8")).digest()
        return hmac.compare_digest(expected, actual)

    def _validate(self):
        if int(time.time() * 1000) > EXPIRES_AT_MS:
            return None, (410, "Gone: token expired")
        if not self._token_matches(self._request_token()):
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

    def _serve(self, head):
        self._served_target = None
        target, error = self._validate()
        if error:
            return self._send_plain(*error)
        if not os.path.isfile(target):
            return self._send_plain(404, "not found")
        # Relative to the resolved root (a linked SERVE_DIR gave "../" paths
        # that named another file) and quoted, since translate_path unquotes:
        # a file literally named "a%20b" was looked up as "a b".
        self._served_target = target
        try:
            self.path = "/" + urllib.parse.quote(os.path.relpath(target, os.path.realpath(SERVE_DIR)).replace(os.sep, "/"))
            return super().do_HEAD() if head else super().do_GET()
        finally:
            self._served_target = None

    def do_GET(self):
        return self._serve(False)

    def do_HEAD(self):
        # Headers only: answering HEAD through do_GET also sent the body.
        return self._serve(True)

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
        served = getattr(self, "_served_target", None)
        if served:
            ext = os.path.splitext(served)[1].lower()
            content_type = self.guess_type(served)
            is_pdf = content_type.split(";", 1)[0].strip().lower() == "application/pdf"
            if not is_pdf:
                self.send_header("Content-Security-Policy", "sandbox")
            if ext in (".html", ".htm", ".xhtml", ".svg", ".xml"):
                self.send_header("Content-Disposition", "attachment")
        else:
            self.send_header("Content-Security-Policy", "sandbox")
        super().end_headers()

    def do_OPTIONS(self):
        if not self._origin_allowed():
            return self._send_plain(403, "Forbidden: origin not allowed")
        self.send_response(204)
        self.end_headers()

# The hub records our PID before allowing the token to serve any files.
if len(sys.argv) == 2:
    deadline = time.monotonic() + 30
    while not os.path.isfile(sys.argv[1]):
        if time.monotonic() >= deadline:
            # A lost SSH response or failed database write never released us.
            workdir = os.path.dirname(sys.argv[0])
            for name in ("proxy.py", "proxy.out"):
                try:
                    os.unlink(os.path.join(workdir, name))
                except FileNotFoundError:
                    pass
            os.rmdir(workdir)
            sys.exit(1)
        time.sleep(0.1)

port = ${input.port || 0}
os.chdir(SERVE_DIR)
with http.server.ThreadingHTTPServer(("0.0.0.0", port), AuthHandler) as httpd:
    actual_port = httpd.server_address[1]
    print(f"PROXY_READY:{actual_port}", flush=True)
    try:
        httpd.timeout = 0.5
        while time.time() * 1000 < EXPIRES_AT_MS:
            httpd.handle_request()
    except KeyboardInterrupt:
        pass
`.trim();
}

/** The secret-bearing Python source is sent on SSH stdin, outside the shell command line. */
export const startFileProxyCommand = `set -eu
umask 077
dir=$(mktemp -d /tmp/.vps_file_proxy_XXXXXXXXXX)
chmod 700 "$dir"
: > "$dir/proxy.py"
: > "$dir/proxy.out"
chmod 600 "$dir/proxy.py" "$dir/proxy.out"
cat > "$dir/proxy.py"
nohup python3 "$dir/proxy.py" "$dir/start" > "$dir/proxy.out" 2>&1 < /dev/null &
echo "$! $dir"`;

/** Linux procfs distinguishes a reused PID from the proxy. Inspection failures are never proof of exit. */
export function fileProxyProcessCommand(pid: number, stop: boolean) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid file proxy PID");
  return `python3 - <<'PY'
import os, re, signal, time

pid = ${pid}
def state():
    try:
        os.kill(pid, 0)
        with open(f"/proc/{pid}/cmdline", "rb") as cmdline:
            args = cmdline.read().split(b"\\x00")
        if not args[0]:
            with open(f"/proc/{pid}/stat", "rb") as stat:
                return "not_running" if stat.read().rsplit(b") ", 1)[1].startswith(b"Z ") else "unknown"
        is_proxy = len(args) >= 2 and os.path.basename(args[0]) == b"python3" and re.fullmatch(
            rb"/tmp/\\.vps_file_proxy_(?:[a-fA-F0-9]{32}\\.py|[a-zA-Z0-9]{10}/proxy\\.py)", args[1])
        return "proxy_running" if is_proxy else "not_running"
    except ProcessLookupError:
        return "not_running"
    except OSError:
        return "unknown"

result = state()
${stop ? `if result == "proxy_running":
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
    for attempt in range(20):
        result = state()
        # During exit Linux can expose an empty cmdline before the task becomes a zombie.
        # Keep observing an unknown state, without sending another signal to this PID.
        if result == "not_running":
            break
        time.sleep(0.1)` : ""}
print(result)
PY`;
}
