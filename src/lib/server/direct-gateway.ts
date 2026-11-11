import { shellQuote } from "@/lib/shell-quote";

export const DIRECT_GATEWAY_DEFAULT_PORT = 31888;
export const DIRECT_GATEWAY_HTTPS_PUBLIC_PORT = 443;
export const DIRECT_GATEWAY_SERVICE_NAME = "vcontrolhub-direct.service";
export const DIRECT_GATEWAY_CADDY_SERVICE_NAME = "vcontrolhub-direct-caddy.service";
export const DIRECT_GATEWAY_CADDY_CONFIG = "/opt/vcontrolhub-direct/Caddyfile";
export const DIRECT_GATEWAY_TLS_DIR = "/opt/vcontrolhub-direct/tls";
// TR-002: 默认仅监听 loopback，避免公网意外暴露。需显式 opt-in 才能监听 0.0.0.0。
export const DIRECT_GATEWAY_BIND_DEFAULT = "127.0.0.1";

export type DirectGatewayRiskLevel = "safe" | "warning" | "danger";

/**
 * Only the level. It used to come with English sentences ("Listening on 0.0.0.0 + http plaintext …") that the
 * server page showed as they were, in Chinese too, and that named 0.0.0.0 and port 31888 whatever was
 * configured; what to say about a level is the page's (`directGatewayAdvice.*`).
 */
export type DirectGatewayRiskAssessment = {
  level: DirectGatewayRiskLevel;
};

/**
 * TR-002: 评估 Direct Gateway 部署风险。
 *  - safe:    bind 127.0.0.1，仅本机可访问
 *  - warning: bind 0.0.0.0 但走 https/caddy 反代，外部可访问但传输加密
 *  - danger:  bind 0.0.0.0 且走 http 明文直连，签名鉴权 ≠ 传输加密，公网暴露风险
 */
export function getDirectGatewayRiskAssessment(input: {
  bindAddress: string;
  publicProtocol: "http" | "https";
}): DirectGatewayRiskAssessment {
  const bind = input.bindAddress.trim();
  const isPublic = bind === "0.0.0.0" || bind === "::" || bind === "[::]";
  if (!isPublic) return { level: "safe" };
  return { level: input.publicProtocol === "https" ? "warning" : "danger" };
}

/**
 * Public base URL handed to browsers.
 * - http: host:31888
 * - https + auto reverse-proxy: host (port 443 omitted)
 * - https manual: host:31888 unless publicPort set
 */
export function buildDirectGatewayPublicBaseUrl(input: {
  host: string;
  port?: number;
  protocol?: "http" | "https";
  autoReverseProxy?: boolean;
  publicPort?: number;
}) {
  const protocol = input.protocol ?? "http";
  const host = input.host.trim();
  const urlHost = shouldBracketIpv6Host(host) ? `[${host}]` : host;
  const autoHttps = protocol === "https" && input.autoReverseProxy !== false;
  const port =
    input.publicPort ??
    (autoHttps ? DIRECT_GATEWAY_HTTPS_PUBLIC_PORT : (input.port ?? DIRECT_GATEWAY_DEFAULT_PORT));
  const defaultPort = protocol === "https" ? 443 : 80;
  if (port === defaultPort) {
    return `${protocol}://${urlHost}`;
  }
  return `${protocol}://${urlHost}:${port}`;
}

function shouldBracketIpv6Host(host: string) {
  return host.includes(":") && !host.startsWith("[") && !host.endsWith("]");
}


/**
 * TR-002 R3: derive the effective transport protocol for the Direct Gateway
 * from the public URL. The publicUrl is the link handed to the browser /
 * download client; its scheme IS the transport that data flows over, so we
 * parse it directly. This is purely a presentation helper — it does not
 * touch the actual service config.
 *
 * Returns `"unknown"` when the URL can't be parsed (which we surface in the
 * UI as a warning rather than a danger, since the configured scheme is
 * unclear and the user should investigate).
 */
export function getResolvedDirectGatewayProtocol(input: {
  publicUrl: string | null;
}): "http" | "https" | "unknown" {
  const raw = input.publicUrl;
  if (!raw) return "unknown";
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return "https";
    if (u.protocol === "http:") return "http";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function pythonGatewaySource() {
  return String.raw`#!/usr/bin/env python3
import hmac
import hashlib
import mimetypes
import os
import posixpath
import re
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
        self._vch_target = None
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
        # The hub signs links for 24 hours at most (a day plus an hour for clock skew); a longer or endless expiry can
        # only come from someone who holds the signing secret.
        if expires_int > int(time.time()) + 90000:
            return None, (403, "invalid expires")
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

    def _serve(self, head):
        target, error = self._validate()
        if target == "__health__":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            if not head:
                self.wfile.write(b"ok")
            return
        if error:
            return self._reject(*error)
        if not os.path.isfile(target):
            return self._reject(404, "not found")
        # Serve exactly the file validated above (never re-parse self.path:
        # "a%20.txt" became "a .txt" and "a.txt#v2" lost "#v2" that way), with
        # Range support so media players can seek and downloads can resume.
        self._vch_target = target
        return self._send_file(target, head)

    def _range_not_satisfiable(self, size):
        self.send_response(416)
        self.send_header("Content-Range", "bytes */" + str(size))
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_file(self, target, head):
        size = os.path.getsize(target)
        start, end, status = 0, size - 1, 200
        range_header = self.headers.get("Range")
        if range_header:
            match = re.match(r"^bytes=(\d*)-(\d*)$", range_header.strip())
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
        self.send_response(status)
        self.send_header("Content-Type", self.guess_type(target))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", "bytes " + str(start) + "-" + str(end) + "/" + str(size))
        self.send_header("Last-Modified", self.date_time_string(os.path.getmtime(target)))
        self.end_headers()
        if head or length == 0:
            return
        with open(target, "rb") as handle:
            handle.seek(start)
            remaining = length
            while remaining > 0:
                chunk = handle.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_GET(self):
        return self._serve(False)

    def do_HEAD(self):
        # Headers only: answering HEAD through do_GET also sent the whole
        # file, and downloaders ask HEAD first.
        return self._serve(True)

    def translate_path(self, path):
        target = getattr(self, "_vch_target", None)
        if target:
            return target
        parsed = urlparse(path)
        normalized = posixpath.normpath("/" + unquote(parsed.path).lstrip("/"))
        return os.path.realpath(os.path.join(ROOT, normalized.lstrip("/")))

if __name__ == "__main__":
    port = int(os.environ.get("DIRECT_PORT", "31888"))
    # TR-002: 默认 127.0.0.1，仅本机可访问；显式 DIRECT_BIND=0.0.0.0 才监听全部接口。
    bind = os.environ.get("DIRECT_BIND", "127.0.0.1")
    os.chdir(ROOT)
    ThreadingHTTPServer((bind, port), Handler).serve_forever()
`;
}

function assertSafeDirectGatewayRoot(rootPath: string) {
  const trimmed = rootPath.trim();
  if (!trimmed.startsWith("/") || trimmed.includes("\0")) {
    throw new Error("Direct Gateway rootPath must be an absolute path");
  }
  const normalized = trimmed.replace(/\/+$/, "") || "/";
  if (normalized === "/" || normalized.includes("/../") || normalized.endsWith("/..") || normalized.includes("/./") || normalized.endsWith("/.")) {
    throw new Error("Direct Gateway rootPath is outside the allowed file boundary");
  }
  // The rootPath is interpolated verbatim into a systemd unit (ReadWritePaths)
  // that systemd parses as root on the target VPS. Restrict to a conservative
  // path charset so no whitespace, control character, or expansion syntax can
  // smuggle additional unit directives into the file.
  if (!/^\/[A-Za-z0-9._/@-]*$/.test(normalized)) {
    throw new Error("Direct Gateway rootPath contains unsupported characters");
  }
  return normalized;
}

/**
 * bindAddress is interpolated into `Environment=DIRECT_BIND=...` inside the
 * systemd unit heredoc. Only host/IP literals (digits, letters, dots, colons,
 * brackets, dashes) are accepted — anything else could break out of the
 * directive and inject unit content.
 */
function assertSafeDirectGatewayBind(bind: string) {
  if (!/^[A-Za-z0-9.:[\]-]{1,64}$/.test(bind)) {
    throw new Error("Direct Gateway bind address contains unsupported characters");
  }
  return bind;
}

/**
 * Caddy install gate shared by both auto-HTTPS branches (TR: duplicated
 * verbatim in the ACME and local-TLS snippets). Prefers the distro package;
 * fails closed rather than downloading an unsigned remote binary as root.
 */
function caddyInstallBlock(): string {
  return `if ! command -v caddy >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y >/tmp/vch-direct-caddy-apt.log 2>&1 || true
    apt-get install -y caddy >/tmp/vch-direct-caddy-apt.log 2>&1 || true
  fi
fi
if ! command -v caddy >/dev/null 2>&1; then
  # Fail closed: do not download an unsigned remote binary as root.
  # Operators must install caddy from a trusted distro package (or pre-provision it).
  echo "caddy is not installed and apt package install failed; install caddy from your distro package and retry" >&2
  exit 1
fi
`;
}

/**
 * Write the Caddyfile heredoc and validate it (shared by both auto-HTTPS
 * branches; only the site block body differs).
 */
function writeAndValidateCaddyfile(siteBlock: string): string {
  const caddyfile = DIRECT_GATEWAY_CADDY_CONFIG;
  return `cat > ${shellQuote(caddyfile)} <<VCH_DIRECT_CADDY
${siteBlock}
VCH_DIRECT_CADDY
caddy validate --config ${shellQuote(caddyfile)} --adapter caddyfile
`;
}

/**
 * Caddy systemd unit heredoc + enable/restart (shared by both auto-HTTPS
 * branches; only ReadWritePaths differs — ACME needs caddy's data dirs for
 * certificate storage, local TLS only the gateway root).
 *
 * Two things systemd.exec(5) says and the unit has to follow. A path in ReadWritePaths that does not exist stops
 * the unit from starting (226/NAMESPACE) unless it is prefixed with "-"; a fresh VPS has no
 * /root/.local/share/caddy. And a system service without User= is given no HOME, so Caddy kept its data under the
 * working directory ("/.local/share/caddy") instead of the directory listed here.
 */
function caddyUnitAndStartBlock(readWritePaths: string): string {
  const caddyfile = DIRECT_GATEWAY_CADDY_CONFIG;
  const caddyUnit = `/etc/systemd/system/${DIRECT_GATEWAY_CADDY_SERVICE_NAME}`;
  return `cat > ${shellQuote(caddyUnit)} <<VCH_DIRECT_CADDY_UNIT
[Unit]
Description=VControlHub Direct Gateway HTTPS reverse proxy
After=network-online.target ${DIRECT_GATEWAY_SERVICE_NAME}
Wants=network-online.target
Requires=${DIRECT_GATEWAY_SERVICE_NAME}

[Service]
Type=simple
Environment=HOME=/root
ExecStart=/usr/bin/env caddy run --config ${caddyfile} --adapter caddyfile
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${readWritePaths}

[Install]
WantedBy=multi-user.target
VCH_DIRECT_CADDY_UNIT
systemctl daemon-reload
systemctl enable ${DIRECT_GATEWAY_CADDY_SERVICE_NAME}
systemctl restart ${DIRECT_GATEWAY_CADDY_SERVICE_NAME}
`;
}

function buildAutoHttpsReverseProxySnippet(input: {
  backendPort: number;
  publicPort: number;
  tlsHost: string;
}) {
  const backendPort = input.backendPort;
  const publicPort = input.publicPort;
  const tlsDir = DIRECT_GATEWAY_TLS_DIR;
  const hostLiteral = input.tlsHost.replace(/[^0-9A-Za-z:.\-]/g, "") || "127.0.0.1";
  const isIp =
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostLiteral) ||
    hostLiteral.includes(":");
  const useAcme = !isIp && publicPort === 443;
  const san = isIp ? `IP:${hostLiteral}` : `DNS:${hostLiteral}`;

  if (useAcme) {
    return `
# --- auto HTTPS reverse proxy (Caddy + Let's Encrypt for domain) ---
install -d -m 0755 ${shellQuote(tlsDir)}
${caddyInstallBlock()}${writeAndValidateCaddyfile(`{
  admin off
}
${hostLiteral} {
  reverse_proxy 127.0.0.1:${backendPort}
  encode zstd gzip
}`)}${caddyUnitAndStartBlock("/opt/vcontrolhub-direct -/var/lib/caddy -/root/.local/share/caddy")}python3 - <<'VCH_DIRECT_PROXY_HEALTH'
import ssl, time
from urllib.request import urlopen
last_error = None
url = "https://${hostLiteral}/__vch_health"
for _ in range(40):
    try:
        ctx = ssl.create_default_context()
        with urlopen(url, timeout=5, context=ctx) as response:
            body = response.read().decode("utf-8", "replace").strip()
            if response.status == 200 and body == "ok":
                break
            last_error = RuntimeError(f"unexpected proxy health: {response.status} {body!r}")
    except Exception as exc:
        last_error = exc
        try:
            ctx2 = ssl._create_unverified_context()
            with urlopen(url, timeout=5, context=ctx2) as response:
                body = response.read().decode("utf-8", "replace").strip()
                if response.status == 200 and body == "ok":
                    break
        except Exception as exc2:
            last_error = exc2
        time.sleep(1)
else:
    raise SystemExit(f"direct gateway https reverse-proxy health failed: {last_error}")
VCH_DIRECT_PROXY_HEALTH
echo vcontrolhub-direct-https-ready
`;
  }

  return `
# --- auto HTTPS reverse proxy (Caddy + local TLS; works with bare IP) ---
install -d -m 0755 ${shellQuote(tlsDir)}
${caddyInstallBlock()}command -v caddy >/dev/null 2>&1 || { echo "caddy install failed" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl missing; cannot create TLS cert" >&2; exit 1; }
if ! openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout ${shellQuote(tlsDir + "/key.pem")} \
  -out ${shellQuote(tlsDir + "/cert.pem")} \
  -days 825 \
  -subj "/CN=vcontrolhub-direct" \
  -addext "subjectAltName=${san}" \
  >/tmp/vch-direct-tls.log 2>&1; then
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout ${shellQuote(tlsDir + "/key.pem")} \
    -out ${shellQuote(tlsDir + "/cert.pem")} \
    -days 825 \
    -subj "/CN=vcontrolhub-direct" \
    >/tmp/vch-direct-tls.log 2>&1
fi
chmod 600 ${shellQuote(tlsDir + "/key.pem")}
chmod 644 ${shellQuote(tlsDir + "/cert.pem")}
${writeAndValidateCaddyfile(`{
  auto_https off
  admin off
}
:${publicPort} {
  tls ${tlsDir}/cert.pem ${tlsDir}/key.pem
  reverse_proxy 127.0.0.1:${backendPort}
  encode zstd gzip
}`)}${caddyUnitAndStartBlock("/opt/vcontrolhub-direct")}python3 - <<'VCH_DIRECT_PROXY_HEALTH'
import ssl, time
from urllib.request import urlopen
ctx = ssl._create_unverified_context()
last_error = None
url = "https://127.0.0.1:${publicPort}/__vch_health"
for _ in range(30):
    try:
        with urlopen(url, timeout=3, context=ctx) as response:
            body = response.read().decode("utf-8", "replace").strip()
            if response.status == 200 and body == "ok":
                break
            last_error = RuntimeError(f"unexpected proxy health: {response.status} {body!r}")
    except Exception as exc:
        last_error = exc
        time.sleep(0.5)
else:
    raise SystemExit(f"direct gateway https reverse-proxy health failed: {last_error}")
VCH_DIRECT_PROXY_HEALTH
echo vcontrolhub-direct-https-ready
`;
}

export function buildInstallDirectGatewayCommand(input: {
  rootPath: string;
  secret: string;
  port?: number;
  bindAddress?: string;
  /**
   * HTTPS product path: bind gateway loopback + install Caddy reverse-proxy
   * with local TLS (works for bare IP). Browser may warn on self-signed cert.
   */
  autoReverseProxy?: boolean;
  publicPort?: number;
  tlsHost?: string;
}) {
  const port = input.port ?? DIRECT_GATEWAY_DEFAULT_PORT;
  const autoProxy = input.autoReverseProxy === true;
  const bind = autoProxy
    ? "127.0.0.1"
    : assertSafeDirectGatewayBind(input.bindAddress ?? DIRECT_GATEWAY_BIND_DEFAULT);
  const publicPort = input.publicPort ?? DIRECT_GATEWAY_HTTPS_PUBLIC_PORT;
  const tlsHost = (input.tlsHost ?? "").trim() || "127.0.0.1";
  const rootPath = assertSafeDirectGatewayRoot(input.rootPath);
  const source = pythonGatewaySource();
  const proxyBlock = autoProxy
    ? buildAutoHttpsReverseProxySnippet({
        backendPort: port,
        publicPort,
        tlsHost,
      })
    : "";

  return `set -eu
install -d -m 0755 /opt/vcontrolhub-direct
install -d -m 0755 ${shellQuote(rootPath)}
cat > /opt/vcontrolhub-direct/server.py <<'VCH_DIRECT_PY'
${source}
VCH_DIRECT_PY
chmod 0755 /opt/vcontrolhub-direct/server.py
cat > /etc/vcontrolhub-direct.env <<VCH_DIRECT_ENV
DIRECT_ROOT=${shellQuote(rootPath)}
DIRECT_SECRET=${shellQuote(input.secret)}
DIRECT_PORT=${port}
DIRECT_BIND=${shellQuote(bind)}
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
# TR-002: 显式声明 DIRECT_BIND (默认 127.0.0.1)。EnvironmentFile 也注入同名, 此处声明便于 systemctl show 审计。
Environment=DIRECT_BIND=${bind}
ExecStart=/usr/bin/env python3 /opt/vcontrolhub-direct/server.py
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/opt/vcontrolhub-direct ${rootPath}

[Install]
WantedBy=multi-user.target
VCH_DIRECT_UNIT
systemctl daemon-reload
systemctl enable ${DIRECT_GATEWAY_SERVICE_NAME}
systemctl restart ${DIRECT_GATEWAY_SERVICE_NAME}
python3 - <<'VCH_DIRECT_HEALTH'
import time
from urllib.request import urlopen
last_error = None
url = "http://127.0.0.1:${port}/__vch_health"
for _ in range(20):
    try:
        with urlopen(url, timeout=3) as response:
            body = response.read().decode("utf-8", "replace").strip()
            if response.status == 200 and body == "ok":
                break
            last_error = RuntimeError(f"unexpected direct gateway health response: {response.status} {body!r}")
    except Exception as exc:
        last_error = exc
        time.sleep(0.5)
else:
    raise SystemExit(f"direct gateway health check failed: {last_error}")
VCH_DIRECT_HEALTH
${proxyBlock}
echo vcontrolhub-direct-ready`;
}

export function buildUninstallDirectGatewayCommand() {
  return `set -eu
systemctl disable --now ${DIRECT_GATEWAY_CADDY_SERVICE_NAME} >/dev/null 2>&1 || true
systemctl disable --now ${DIRECT_GATEWAY_SERVICE_NAME} >/dev/null 2>&1 || true
rm -f /etc/systemd/system/${DIRECT_GATEWAY_CADDY_SERVICE_NAME}
rm -f /etc/systemd/system/${DIRECT_GATEWAY_SERVICE_NAME}
rm -f /etc/vcontrolhub-direct.env
rm -rf /opt/vcontrolhub-direct
systemctl daemon-reload || true
echo vcontrolhub-direct-removed`;
}
