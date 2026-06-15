export const DIRECT_GATEWAY_DEFAULT_PORT = 31888;
export const DIRECT_GATEWAY_SERVICE_NAME = "vcontrolhub-direct.service";
// TR-002: 默认仅监听 loopback，避免公网意外暴露。需显式 opt-in 才能监听 0.0.0.0。
export const DIRECT_GATEWAY_BIND_DEFAULT = "127.0.0.1";

export type DirectGatewayRiskLevel = "safe" | "warning" | "danger";

export type DirectGatewayRiskAssessment = {
	level: DirectGatewayRiskLevel;
	reasons: string[];
	recommendations: string[];
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
	const reasons: string[] = [];
	const recommendations: string[] = [];
	const bind = input.bindAddress.trim();
	const isPublic = bind === "0.0.0.0" || bind === "::" || bind === "[::]";

	if (!isPublic) {
		return { level: "safe", reasons: [`仅监听 ${bind}，不会暴露公网`], recommendations: [] };
	}

	if (input.publicProtocol === "https") {
		reasons.push(`监听 ${bind} 但走 https/Caddy 反代，传输已加密`);
		recommendations.push("确认 Caddy 已配 TLS 证书 + 反代 `/direct` 到 127.0.0.1:31888");
		return { level: "warning", reasons, recommendations };
	}

	reasons.push("监听 0.0.0.0 + http 明文直连 = 签名鉴权 ≠ 传输加密");
	reasons.push("HMAC 签名可防篡改，但任何中间人都能读取文件内容");
	recommendations.push("方案 A：在远端 server 上部署 Caddy 反代 `/direct` → 127.0.0.1:31888 + 自动 TLS");
	recommendations.push("方案 B：用 VPN / WireGuard / Tailscale 把 31888 仅暴露给可信网段");
	recommendations.push("方案 C：防火墙白名单，仅允许已知 IP 段访问 31888");
	recommendations.push("短期兜底：把 bindAddress 改回 127.0.0.1 + 走 VControlHub 主站中转");
	return { level: "danger", reasons, recommendations };
}

export function buildDirectGatewayPublicBaseUrl(input: {
	host: string;
	port?: number;
	protocol?: "http" | "https";
}) {
	const port = input.port ?? DIRECT_GATEWAY_DEFAULT_PORT;
	const protocol = input.protocol ?? "http";
	const host = input.host.trim();
	const urlHost = shouldBracketIpv6Host(host) ? `[${host}]` : host;
	return `${protocol}://${urlHost}:${port}`;
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
    # TR-002: 默认 127.0.0.1，仅本机可访问；显式 DIRECT_BIND=0.0.0.0 才监听全部接口。
    bind = os.environ.get("DIRECT_BIND", "127.0.0.1")
    os.chdir(ROOT)
    ThreadingHTTPServer((bind, port), Handler).serve_forever()
`;
}

export function buildInstallDirectGatewayCommand(input: {
  rootPath: string;
  secret: string;
  port?: number;
  bindAddress?: string;
}) {
  const port = input.port ?? DIRECT_GATEWAY_DEFAULT_PORT;
  const bind = input.bindAddress ?? DIRECT_GATEWAY_BIND_DEFAULT;
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
ReadWritePaths=/opt/vcontrolhub-direct ${input.rootPath}

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
