import { describe, expect, it } from "vitest";

import {
  DIRECT_GATEWAY_DEFAULT_PORT,
  buildDirectGatewayPublicBaseUrl,
  buildInstallDirectGatewayCommand,
  buildUninstallDirectGatewayCommand,
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
    expect(command).toContain(
      "systemctl enable --now vcontrolhub-direct.service",
    );
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
