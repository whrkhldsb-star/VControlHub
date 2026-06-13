import { describe, expect, it } from "vitest";

import { getDirectGatewayHealthyNote, getDirectGatewayRepairAdvice } from "../direct-gateway-advice";

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
    const advice = getDirectGatewayRepairAdvice({ ...baseInput, serverEnabled: false });
    expect(advice).toHaveLength(1);
    expect(advice[0].title).toBe("节点未启用");
    expect(advice[0].priority).toBe("primary");
    expect(advice[0].href).toBe("/servers");
  });

  it("2. flags missing SFTP node as primary advice when direct gateway is enabled", () => {
    const advice = getDirectGatewayRepairAdvice({
      ...baseInput,
      directGateway: { enabled: true, statusLabel: "目标直连", publicUrl: "http://1.2.3.4:31888", port: 31888 },
      hasStorageNode: false,
    });
    expect(advice[0].title).toBe("直连已启用但缺少 SFTP 节点");
    expect(advice[0].href).toBe("/servers");
  });

  it("3. flags inconsistent direct-gateway state when port<=0 or publicUrl is missing", () => {
    const advice = getDirectGatewayRepairAdvice({
      ...baseInput,
      directGateway: { enabled: true, statusLabel: "目标直连", publicUrl: null, port: 0 },
    });
    expect(advice[0].title).toBe("直连状态不一致");
    expect(advice[0].detail).toContain("切回网站中转");
  });

  it("4. suggests enabling direct gateway when not enabled and SFTP is bound", () => {
    const advice = getDirectGatewayRepairAdvice({
      ...baseInput,
      directGateway: { enabled: false, statusLabel: "网站中转", publicUrl: null, port: 0 },
    });
    expect(advice[0].title).toBe("可启用目标直连");
    expect(advice[0].priority).toBe("primary");
  });

  it("5. suggests binding SFTP first when not enabled and no SFTP is bound", () => {
    const advice = getDirectGatewayRepairAdvice({
      ...baseInput,
      directGateway: { enabled: false, statusLabel: "网站中转", publicUrl: null, port: 0 },
      hasStorageNode: false,
    });
    expect(advice[0].title).toBe("先绑定 SFTP 存储节点");
  });

  it("6. adds a secondary 'pending commands' note when command backlog > 0", () => {
    const advice = getDirectGatewayRepairAdvice({
      ...baseInput,
      directGateway: { enabled: false, statusLabel: "网站中转", publicUrl: null, port: 0 },
      pendingCommandCount: 3,
    });
    expect(advice).toHaveLength(2);
    expect(advice[1].title).toContain("3 条待处理");
    expect(advice[1].href).toBe("/requests");
    expect(advice[1].priority).toBe("secondary");
  });

  it("7. adds a 'healthy' documentation note only when there is no other advice and user can manage servers", () => {
    const advice = getDirectGatewayRepairAdvice({
      ...baseInput,
      directGateway: { enabled: true, statusLabel: "目标直连", publicUrl: "http://1.2.3.4:31888", port: 31888 },
    });
    expect(advice).toHaveLength(1);
    expect(advice[0].title).toBe("Direct Gateway 边界文档");
    expect(advice[0].priority).toBe("secondary");
  });

  it("omits 'healthy' note when user cannot manage servers", () => {
    const advice = getDirectGatewayRepairAdvice({
      ...baseInput,
      directGateway: { enabled: true, statusLabel: "目标直连", publicUrl: "http://1.2.3.4:31888", port: 31888 },
      canManageServers: false,
    });
    expect(advice).toHaveLength(0);
  });

  it("hides '/servers' anchor when user cannot manage servers (rule 1 still shown)", () => {
    const advice = getDirectGatewayRepairAdvice({ ...baseInput, serverEnabled: false, canManageServers: false });
    expect(advice).toHaveLength(1);
    expect(advice[0].title).toBe("节点未启用");
    expect(advice[0].href).toBeNull();
  });

  it("treats undefined directGateway the same as disabled (no crash)", () => {
    const advice = getDirectGatewayRepairAdvice({ ...baseInput, directGateway: undefined });
    expect(advice[0].title).toBe("可启用目标直连");
  });
});

describe("getDirectGatewayHealthyNote", () => {
  it("mentions publicUrl when present", () => {
    expect(
      getDirectGatewayHealthyNote({ statusLabel: "目标直连", publicUrl: "http://1.2.3.4:31888" }),
    ).toContain("公网入口 http://1.2.3.4:31888");
  });

  it("falls back to 'relay' wording when publicUrl is missing", () => {
    expect(getDirectGatewayHealthyNote({ statusLabel: "网站中转", publicUrl: null })).toContain("回退到网站服务器中转");
  });
});
