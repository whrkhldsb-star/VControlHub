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
import re
import stat
import sys
import time
import urllib.parse

TOKEN = ${pythonStringLiteral(input.accessToken)}
EXPIRES_AT_MS = ${input.expiresAtMs}
SERVE_DIR = ${pythonStringLiteral(input.serveDir)}
CANONICAL_ROOT = os.path.realpath(SERVE_DIR)
ALLOWED_ORIGIN = ${pythonStringLiteral(input.allowedOrigin)}
DIRECTORY_FLAGS = getattr(os, "O_RDONLY", 0) | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
FILE_FLAGS = getattr(os, "O_RDONLY", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
ROOT_FD = None

class AuthHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "VControlHubFileProxy/2.0"

    def _send_plain(self, code, message):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(message.encode("utf-8"))

    def list_directory(self, path):
        return self._send_plain(404, "not found")

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
        raw_rel = urllib.parse.unquote(parsed.path).lstrip("/")
        if not raw_rel or "\\x00" in raw_rel:
            return None, (404, "not found")
        parts = [p for p in raw_rel.split("/") if p]
        if not parts or any(p in (".", "..") for p in parts):
            return None, (400, "invalid path")
        return "/".join(parts), None

    def _open_pinned(self, relative):
        parts = relative.split("/")
        if ROOT_FD is not None and hasattr(os, "O_NOFOLLOW"):
            parent = os.dup(ROOT_FD)
            try:
                for part in parts[:-1]:
                    child = os.open(part, DIRECTORY_FLAGS, dir_fd=parent)
                    os.close(parent)
                    parent = child
                return os.open(parts[-1], FILE_FLAGS, dir_fd=parent)
            finally:
                os.close(parent)
        target = os.path.realpath(os.path.join(CANONICAL_ROOT, *parts))
        if not target.startswith(CANONICAL_ROOT + os.sep) or os.path.islink(os.path.join(CANONICAL_ROOT, *parts)):
            raise OSError("outside root")
        return os.open(target, os.O_RDONLY)

    def _range_not_satisfiable(self, size):
        self.send_response(416)
        self.send_header("Content-Range", "bytes */" + str(size))
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _serve(self, head):
        self._served_target = None
        relative, error = self._validate()
        if error:
            return self._send_plain(*error)
        try:
            fd = self._open_pinned(relative)
        except OSError:
            return self._send_plain(404, "not found")
        try:
            metadata = os.fstat(fd)
            if not stat.S_ISREG(metadata.st_mode):
                return self._send_plain(404, "not found")
            if os.path.isdir("/proc/self/fd"):
                try:
                    actual = os.readlink(f"/proc/self/fd/{fd}")
                except OSError:
                    return self._send_plain(404, "not found")
                if actual != os.path.join(CANONICAL_ROOT, *relative.split("/")):
                    return self._send_plain(404, "not found")
            size = metadata.st_size
            start, end, status = 0, size - 1, 200
            range_header = self.headers.get("Range")
            if range_header:
                match = re.match(r"^bytes=(\\d*)-(\\d*)$", range_header.strip())
                if not match or (match.group(1) == "" and match.group(2) == ""):
                    return self._range_not_satisfiable(size)
                if match.group(1) == "":
                    suffix = int(match.group(2))
                    if suffix == 0 or size == 0:
                        return self._range_not_satisfiable(size)
                    start = max(0, size - suffix)
                else:
                    start = int(match.group(1))
                    if match.group(2) != "":
                        end = min(int(match.group(2)), size - 1)
                if size == 0 or start > end or start >= size:
                    return self._range_not_satisfiable(size)
                status = 206
            length = end - start + 1 if size > 0 else 0
            self._served_target = relative
            content_type = self.guess_type(relative)
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(length))
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Last-Modified", self.date_time_string(metadata.st_mtime))
            self.end_headers()
            if head or length == 0:
                return
            os.lseek(fd, start, os.SEEK_SET)
            remaining = length
            while remaining > 0:
                chunk = os.read(fd, min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)
        finally:
            self._served_target = None
            os.close(fd)

    def do_GET(self):
        return self._serve(False)

    def do_HEAD(self):
        # Headers only: answering HEAD through do_GET also sent the body.
        return self._serve(True)

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
os.chdir(CANONICAL_ROOT)
if hasattr(os, "O_DIRECTORY") and hasattr(os, "O_NOFOLLOW"):
    ROOT_FD = os.open(CANONICAL_ROOT, DIRECTORY_FLAGS)
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
