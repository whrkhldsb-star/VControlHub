import { describe, expect, it } from "vitest";

import { getDirectGatewayHealthyNote, getDirectGatewayRepairAdvice } from "../direct-gateway-advice";

import { zh as dict } from "@/lib/i18n/dictionaries/servers";

/**
 * Mock `t(key)` that resolves keys against the zh dictionary, falling back to
 * the key itself. The advice helpers receive the same dictionary the production
 * UI uses, so this keeps the existing assertions (which were authored against
 * the literal Chinese strings) meaningful.
 */
function t(key: string): string {
	return dict[key] ?? key;
}

const baseInput = {
  directGateway: null as null | {
    enabled: boolean;
    statusLabel: string;
    publicUrl: string | null;
    port: number;
  },
  serverEnabled: true,
  hasStorageNode: true,
  pendingCommandCount: 0,
  canManageServers: true,
};

describe("getDirectGatewayRepairAdvice", () => {
  it("1. returns 'enable node' as the only advice when the node is disabled", () => {
    const advice = getDirectGatewayRepairAdvice(t, { ...baseInput, serverEnabled: false });
    expect(advice).toHaveLength(1);
    expect(advice[0]!.title).toBe("节点未启用");
    expect(advice[0]!.priority).toBe("primary");
    expect(advice[0]!.href).toBe("/servers");
  });

  it("2. flags missing SFTP node as primary advice when direct gateway is enabled", () => {
    const advice = getDirectGatewayRepairAdvice(t, {
      ...baseInput,
      directGateway: { enabled: true, statusLabel: "目标直连", publicUrl: "http://1.2.3.4:31888", port: 31888 },
      hasStorageNode: false,
    });
    expect(advice[0]!.title).toBe("直连已启用但缺少 SFTP 节点");
    expect(advice[0]!.href).toBe("/servers");
  });

  it("3. flags inconsistent direct-gateway state when port<=0 or publicUrl is missing", () => {
    const advice = getDirectGatewayRepairAdvice(t, {
      ...baseInput,
      directGateway: { enabled: true, statusLabel: "目标直连", publicUrl: null, port: 0 },
    });
    expect(advice[0]!.title).toBe("直连状态不一致");
    expect(advice[0]!.detail).toContain("切回网站中转");
  });

  it("4. suggests enabling direct gateway when not enabled and SFTP is bound", () => {
    const advice = getDirectGatewayRepairAdvice(t, {
      ...baseInput,
      directGateway: { enabled: false, statusLabel: "网站中转", publicUrl: null, port: 0 },
    });
    expect(advice[0]!.title).toBe("可启用目标直连");
    expect(advice[0]!.priority).toBe("primary");
  });

  it("5. suggests binding SFTP first when not enabled and no SFTP is bound", () => {
    const advice = getDirectGatewayRepairAdvice(t, {
      ...baseInput,
      directGateway: { enabled: false, statusLabel: "网站中转", publicUrl: null, port: 0 },
      hasStorageNode: false,
    });
    expect(advice[0]!.title).toBe("先绑定 SFTP 存储节点");
  });

  it("6. adds a secondary 'pending commands' note when command backlog > 0", () => {
    const advice = getDirectGatewayRepairAdvice(t, {
      ...baseInput,
      directGateway: { enabled: false, statusLabel: "网站中转", publicUrl: null, port: 0 },
      pendingCommandCount: 3,
    });
    expect(advice).toHaveLength(2);
    expect(advice[1]!.title).toContain("3 条待处理");
    expect(advice[1]!.href).toBe("/requests");
    expect(advice[1]!.priority).toBe("secondary");
  });

  it("7. shows a 'safe transport' banner (loopback bind) instead of the doc note when no other advice", () => {
    // TR-002 R3: 直连已就位 + loopback bind → risk=safe 触发 emerald secondary
    // banner。设计取舍：安全状态下不重复追加"边界文档"secondary，避免噪音。
    const advice = getDirectGatewayRepairAdvice(t, {
      ...baseInput,
      directGateway: {
        enabled: true,
        statusLabel: "目标直连",
        publicUrl: "http://1.2.3.4:31888",
        port: 31888,
        bindAddress: "127.0.0.1",
        publicProtocol: "http",
      },
    });
    expect(advice).toHaveLength(1);
    expect(advice[0]!.title).toBe("直连传输安全");
    expect(advice[0]!.tone).toBe("emerald");
    expect(advice[0]!.priority).toBe("secondary");
  });

  it("omits boundary doc note when user cannot manage servers (safe banner still surfaces)", () => {
    // TR-002 R3: 同上, 显式给 loopback bind → safe banner 仍会出现, 但无边界文档
    const advice = getDirectGatewayRepairAdvice(t, {
      ...baseInput,
      directGateway: {
        enabled: true,
        statusLabel: "目标直连",
        publicUrl: "http://1.2.3.4:31888",
        port: 31888,
        bindAddress: "127.0.0.1",
        publicProtocol: "http",
      },
      canManageServers: false,
    });
    expect(advice).toHaveLength(1);
    expect(advice[0]!.title).toBe("直连传输安全");
    expect(advice[0]!.tone).toBe("emerald");
  });

  it("hides '/servers' anchor when user cannot manage servers (rule 1 still shown)", () => {
    const advice = getDirectGatewayRepairAdvice(t, { ...baseInput, serverEnabled: false, canManageServers: false });
    expect(advice).toHaveLength(1);
    expect(advice[0]!.title).toBe("节点未启用");
    expect(advice[0]!.href).toBeNull();
  });

  it("treats undefined directGateway the same as disabled (no crash)", () => {
    const advice = getDirectGatewayRepairAdvice(t, { ...baseInput, directGateway: undefined });
    expect(advice[0]!.title).toBe("可启用目标直连");
  });
});

describe("getDirectGatewayHealthyNote", () => {
  it("mentions publicUrl when present", () => {
    expect(
      getDirectGatewayHealthyNote(t, { statusLabel: "目标直连", publicUrl: "http://1.2.3.4:31888" }),
    ).toContain("公网入口 http://1.2.3.4:31888");
  });

  it("falls back to 'relay' wording when publicUrl is missing", () => {
    expect(getDirectGatewayHealthyNote(t, { statusLabel: "网站中转", publicUrl: null })).toContain("回退到网站服务器中转");
  });
});

// TR-002 R3: 直连已就位时按 bind + protocol 输出 risk banner
describe("TR-002 R3 risk banner", () => {
  const enabledInput = {
    serverEnabled: true,
    hasStorageNode: true,
    pendingCommandCount: 0,
    canManageServers: true,
  };

  it("emits a safe emerald banner when bind is loopback + http", () => {
    const advice = getDirectGatewayRepairAdvice(t, {
      ...enabledInput,
      directGateway: {
        enabled: true,
        statusLabel: "目标直连",
        publicUrl: "http://203.0.113.10:31888",
        port: 31888,
        bindAddress: "127.0.0.1",
        publicProtocol: "http",
      },
    });
    const banner = advice.find((a) => a.title === "直连传输安全");
    expect(banner).toBeDefined();
    expect(banner?.priority).toBe("secondary");
    expect(banner?.tone).toBe("emerald");
    expect(banner?.href).toBeNull();
  });

  it("emits an amber warning banner when bind is 0.0.0.0 + https", () => {
    const advice = getDirectGatewayRepairAdvice(t, {
      ...enabledInput,
      directGateway: {
        enabled: true,
        statusLabel: "目标直连",
        publicUrl: "https://direct.example.com:31888",
        port: 31888,
        bindAddress: "0.0.0.0",
        publicProtocol: "https",
      },
    });
    const banner = advice.find((a) => a.title.startsWith("直连传输"));
    expect(banner).toBeDefined();
    expect(banner?.tone).toBe("amber");
    expect(banner?.priority).toBe("primary");
  });

  it("emits a rose danger banner when bind is 0.0.0.0 + http", () => {
    const advice = getDirectGatewayRepairAdvice(t, {
      ...enabledInput,
      directGateway: {
        enabled: true,
        statusLabel: "目标直连",
        publicUrl: "http://203.0.113.10:31888",
        port: 31888,
        bindAddress: "0.0.0.0",
        publicProtocol: "http",
      },
    });
    const banner = advice.find((a) => a.title.startsWith("直连传输"));
    expect(banner).toBeDefined();
    expect(banner?.tone).toBe("rose");
    expect(banner?.priority).toBe("primary");
    expect(banner?.detail).toMatch(/signature auth/);
  });

  it("adds an amber 'scheme unrecognized' secondary hint when protocol is unknown", () => {
    const advice = getDirectGatewayRepairAdvice(t, {
      ...enabledInput,
      directGateway: {
        enabled: true,
        statusLabel: "目标直连",
        publicUrl: "garbage://something",
        port: 31888,
        bindAddress: "0.0.0.0",
        publicProtocol: "unknown",
      },
    });
    const hint = advice.find((a) => a.title === "公网入口协议未识别");
    expect(hint).toBeDefined();
    expect(hint?.tone).toBe("amber");
    expect(hint?.priority).toBe("secondary");
  });

  it("does NOT emit a risk banner when the gateway is not enabled", () => {
    const advice = getDirectGatewayRepairAdvice(t, {
      ...enabledInput,
      directGateway: {
        enabled: false,
        statusLabel: "网站中转",
        publicUrl: null,
        port: 0,
        bindAddress: "0.0.0.0",
        publicProtocol: "http",
      },
    });
    expect(advice.some((a) => a.title.startsWith("直连传输"))).toBe(false);
  });

  it("falls back to loopback when bindAddress is missing", () => {
    const advice = getDirectGatewayRepairAdvice(t, {
      ...enabledInput,
      directGateway: {
        enabled: true,
        statusLabel: "目标直连",
        publicUrl: "http://203.0.113.10:31888",
        port: 31888,
        // bindAddress omitted on purpose
        publicProtocol: "http",
      },
    });
    const banner = advice.find((a) => a.title === "直连传输安全");
    expect(banner).toBeDefined();
    expect(banner?.tone).toBe("emerald");
  });
});
