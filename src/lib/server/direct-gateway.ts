export const DIRECT_GATEWAY_DEFAULT_PORT = 31888;
export const DIRECT_GATEWAY_SERVICE_NAME = "vcontrolhub-direct.service";

export function buildDirectGatewayPublicBaseUrl(input: {
  host: string;
  port?: number;
}) {
  const port = input.port ?? DIRECT_GATEWAY_DEFAULT_PORT;
  const host = input.host.trim();
  const urlHost = shouldBracketIpv6Host(host) ? `[${host}]` : host;
  return `http://${urlHost}:${port}`;
}

function shouldBracketIpv6Host(host: string) {
  return host.includes(":") && !host.startsWith("[") && !host.endsWith("]");
}

export function getDirectGatewayStatusLabel(input: {
  fileProxyPort?: number | null;
  publicUrl?: string | null;
}) {
  return input.fileProxyPort && input.fileProxyPort > 0 && input.publicUrl
    ? "目标直连"
    : "网站中转";
}

function shellQuote(value: string | number) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function pythonGatewaySource() {
  return String.raw`#!/usr/bin/env python3
import hmac
import hashlib
import mimetypes
import os
import posixpath
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import unquote, urlparse, parse_qs

ROOT = os.environ.get("DIRECT_ROOT", "/root")
SECRET = os.environ.get("DIRECT_SECRET", "")

class Handler(SimpleHTTPRequestHandler):
    server_version = "VControlHubDirect/1.0"

    def _reject(self, code, message):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(message.encode("utf-8"))

    def _validate(self):
        if not SECRET:
            return None, (500, "direct secret missing")
        parsed = urlparse(self.path)
        if parsed.path == "/__vch_health":
            return "__health__", None
        qs = parse_qs(parsed.query)
        expires = qs.get("expires", [""])[0]
        signature = qs.get("signature", [""])[0]
        try:
            expires_int = int(expires)
        except ValueError:
            return None, (403, "invalid expires")
        if expires_int < int(time.time()):
            return None, (403, "link expired")
        normalized = posixpath.normpath("/" + unquote(parsed.path).lstrip("/"))
        if normalized.startswith("/../") or normalized == "/..":
            return None, (400, "invalid path")
        expected = hmac.new(SECRET.encode("utf-8"), f"{normalized}.{expires}".encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return None, (403, "bad signature")
        fs_path = os.path.realpath(os.path.join(ROOT, normalized.lstrip("/")))
        root_real = os.path.realpath(ROOT)
        if fs_path != root_real and not fs_path.startswith(root_real + os.sep):
            return None, (400, "path outside root")
        return fs_path, None

    def do_GET(self):
        target, error = self._validate()
        if target == "__health__":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        if error:
            return self._reject(*error)
        if not os.path.isfile(target):
            return self._reject(404, "not found")
        self.path = "/" + os.path.relpath(target, ROOT).replace(os.sep, "/")
        return super().do_GET()

    def do_HEAD(self):
        return self.do_GET()

    def translate_path(self, path):
        parsed = urlparse(path)
        normalized = posixpath.normpath("/" + unquote(parsed.path).lstrip("/"))
        return os.path.realpath(os.path.join(ROOT, normalized.lstrip("/")))

if __name__ == "__main__":
    port = int(os.environ.get("DIRECT_PORT", "31888"))
    os.chdir(ROOT)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
`;
}

export function buildInstallDirectGatewayCommand(input: {
  rootPath: string;
  secret: string;
  port?: number;
}) {
  const port = input.port ?? DIRECT_GATEWAY_DEFAULT_PORT;
  const source = pythonGatewaySource();
  return `set -eu
install -d -m 0755 /opt/vcontrolhub-direct
install -d -m 0755 ${shellQuote(input.rootPath)}
cat > /opt/vcontrolhub-direct/server.py <<'VCH_DIRECT_PY'
${source}
VCH_DIRECT_PY
chmod 0755 /opt/vcontrolhub-direct/server.py
cat > /etc/vcontrolhub-direct.env <<VCH_DIRECT_ENV
DIRECT_ROOT=${shellQuote(input.rootPath)}
DIRECT_SECRET=${shellQuote(input.secret)}
DIRECT_PORT=${port}
VCH_DIRECT_ENV
chmod 0600 /etc/vcontrolhub-direct.env
cat > /etc/systemd/system/${DIRECT_GATEWAY_SERVICE_NAME} <<'VCH_DIRECT_UNIT'
[Unit]
Description=VControlHub secure direct file gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/vcontrolhub-direct.env
ExecStart=/usr/bin/env python3 /opt/vcontrolhub-direct/server.py
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/opt/vcontrolhub-direct ${input.rootPath}

[Install]
WantedBy=multi-user.target
VCH_DIRECT_UNIT
systemctl daemon-reload
systemctl enable --now ${DIRECT_GATEWAY_SERVICE_NAME}
curl -fsS http://127.0.0.1:${port}/__vch_health >/dev/null
echo vcontrolhub-direct-ready`;
}

export function buildUninstallDirectGatewayCommand() {
  return `set -eu
systemctl disable --now ${DIRECT_GATEWAY_SERVICE_NAME} >/dev/null 2>&1 || true
rm -f /etc/systemd/system/${DIRECT_GATEWAY_SERVICE_NAME}
rm -f /etc/vcontrolhub-direct.env
rm -rf /opt/vcontrolhub-direct
systemctl daemon-reload || true
echo vcontrolhub-direct-removed`;
}
