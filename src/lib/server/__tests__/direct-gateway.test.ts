import { describe, expect, it } from "vitest";

import {
  DIRECT_GATEWAY_BIND_DEFAULT,
  DIRECT_GATEWAY_DEFAULT_PORT,
  buildDirectGatewayPublicBaseUrl,
  buildInstallDirectGatewayCommand,
  buildUninstallDirectGatewayCommand,
  getDirectGatewayRiskAssessment,
  getDirectGatewayStatusLabel,
} from "@/lib/server/direct-gateway";

describe("direct gateway helpers", () => {
  it("builds a stable public base url from the server host and default port", () => {
    expect(buildDirectGatewayPublicBaseUrl({ host: "203.0.113.10" })).toBe(
      `http://203.0.113.10:${DIRECT_GATEWAY_DEFAULT_PORT}`,
    );
    expect(
      buildDirectGatewayPublicBaseUrl({
        host: "media.example.com",
        port: 39090,
      }),
    ).toBe("http://media.example.com:39090");
  });

  it("wraps IPv6 hosts in URL brackets for direct gateway public urls", () => {
    expect(buildDirectGatewayPublicBaseUrl({ host: "2001:db8::10" })).toBe(
      `http://[2001:db8::10]:${DIRECT_GATEWAY_DEFAULT_PORT}`,
    );
    expect(
      buildDirectGatewayPublicBaseUrl({ host: " [2001:db8::20] ", port: 39090 }),
    ).toBe("http://[2001:db8::20]:39090");
  });

  it("generates an install command that writes the gateway, env, and systemd unit for the storage root", () => {
    const command = buildInstallDirectGatewayCommand({
      rootPath: "/data/media",
      secret: "direct-secret",
      port: 31888,
    });

    expect(command).toContain("vcontrolhub-direct.service");
    expect(command).toContain("DIRECT_ROOT='/data/media'");
    expect(command).toContain("DIRECT_SECRET='direct-secret'");
    expect(command).toContain(
      "ReadWritePaths=/opt/vcontrolhub-direct /data/media",
    );
    expect(command).toContain("DIRECT_PORT=31888");
    expect(command).toContain("systemctl enable vcontrolhub-direct.service");
    expect(command).toContain("systemctl restart vcontrolhub-direct.service");
    expect(command).toContain("python3 - <<'VCH_DIRECT_HEALTH'");
    expect(command).toContain("http://127.0.0.1:31888/__vch_health");
    expect(command).not.toContain("rm -rf /");
  });

  it("generates a precise uninstall command for only the VControlHub direct service", () => {
    const command = buildUninstallDirectGatewayCommand();

    expect(command).toContain(
      "systemctl disable --now vcontrolhub-direct.service",
    );
    expect(command).toContain(
      "rm -f /etc/systemd/system/vcontrolhub-direct.service",
    );
    expect(command).toContain("rm -rf /opt/vcontrolhub-direct");
    expect(command).not.toContain("rm -rf /data");
    expect(command).not.toContain("rm -rf /root");
  });

  it("summarizes global direct access status for the server panel", () => {
    expect(
      getDirectGatewayStatusLabel({ fileProxyPort: 0, publicUrl: null }),
    ).toBe("网站中转");
    expect(
      getDirectGatewayStatusLabel({
        fileProxyPort: 31888,
        publicUrl: "http://203.0.113.10:31888",
      }),
    ).toBe("目标直连");
  });
});

describe("TR-002 direct gateway TLS hardening", () => {
  it("默认 bind 127.0.0.1（避免公网意外暴露）", () => {
    expect(DIRECT_GATEWAY_BIND_DEFAULT).toBe("127.0.0.1");
  });

  it("风险评估: bind 127.0.0.1 = safe", () => {
    const result = getDirectGatewayRiskAssessment({
      bindAddress: "127.0.0.1",
      publicProtocol: "http",
    });
    expect(result.level).toBe("safe");
    expect(result.reasons[0]).toContain("127.0.0.1");
    expect(result.recommendations).toHaveLength(0);
  });

  it("风险评估: bind 0.0.0.0 + http = danger, 推荐 Caddy/VPN/防火墙", () => {
    const result = getDirectGatewayRiskAssessment({
      bindAddress: "0.0.0.0",
      publicProtocol: "http",
    });
    expect(result.level).toBe("danger");
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.recommendations.length).toBeGreaterThanOrEqual(3);
    expect(result.recommendations.some((r) => r.includes("Caddy"))).toBe(true);
    expect(result.recommendations.some((r) => r.includes("VPN"))).toBe(true);
  });

  it("风险评估: bind 0.0.0.0 + https/Caddy = warning", () => {
    const result = getDirectGatewayRiskAssessment({
      bindAddress: "0.0.0.0",
      publicProtocol: "https",
    });
    expect(result.level).toBe("warning");
    expect(result.recommendations[0]).toContain("Caddy");
  });

  it("风险评估: bind IPv6 :: = 公网暴露", () => {
    const result = getDirectGatewayRiskAssessment({
      bindAddress: "::",
      publicProtocol: "http",
    });
    expect(result.level).toBe("danger");
  });

  it("buildDirectGatewayPublicBaseUrl 支持 https 协议", () => {
    expect(
      buildDirectGatewayPublicBaseUrl({ host: "media.example.com", protocol: "https" }),
    ).toBe(`https://media.example.com:${DIRECT_GATEWAY_DEFAULT_PORT}`);
    // 向后兼容: 默认 protocol=undefined 时仍返 http
    expect(buildDirectGatewayPublicBaseUrl({ host: "media.example.com" })).toBe(
      `http://media.example.com:${DIRECT_GATEWAY_DEFAULT_PORT}`,
    );
  });

  it("buildInstallDirectGatewayCommand 默认 DIRECT_BIND=127.0.0.1 (Python + systemd 显式声明)", () => {
    const command = buildInstallDirectGatewayCommand({
      rootPath: "/data/media",
      secret: "direct-secret",
      port: 31888,
    });
    // 1. env file 写入
    expect(command).toContain("DIRECT_BIND='127.0.0.1'");
    expect(command).toContain("DIRECT_PORT=31888");
    // 2. systemd unit 显式声明 (便于 systemctl show 审计)
    expect(command).toContain("Environment=DIRECT_BIND=127.0.0.1");
    // 3. Python 源码用 env var 而非硬编码 0.0.0.0
    expect(command).toMatch(/os\.environ\.get\("DIRECT_BIND",\s*"127\.0\.0\.1"\)/);
  });

  it("buildInstallDirectGatewayCommand 显式 opt-in 到 0.0.0.0", () => {
    const command = buildInstallDirectGatewayCommand({
      rootPath: "/data/media",
      secret: "direct-secret",
      port: 31888,
      bindAddress: "0.0.0.0",
    });
    expect(command).toContain("DIRECT_BIND='0.0.0.0'");
    expect(command).toContain("Environment=DIRECT_BIND=0.0.0.0");
  });
});
