/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverFindUnique: vi.fn(),
  serverUpdate: vi.fn(),
  agentJobCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: mocks.serverFindUnique, update: mocks.serverUpdate },
    serverAgentJob: { create: mocks.agentJobCreate },
  },
}));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));
vi.mock("../monitor", () => ({ MONITOR_SCRIPT: "echo metrics" }));

import { AGENT_CLEANUP_COMMAND, authenticateServerAgent, executeCommandWithAgent, issueServerAgentToken } from "../agent-service";

describe("server Agent authentication and routing", () => {
  it("stores only a token digest and authenticates the issued bearer token", async () => {
    mocks.serverUpdate.mockResolvedValueOnce({ id: "srv1" });
    const token = await issueServerAgentToken("srv1");
    const stored = mocks.serverUpdate.mock.calls[0]?.[0]?.data.agentTokenHash as string;
    expect(token).toMatch(/^vca_srv1_/);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toContain(token);

    mocks.serverFindUnique.mockResolvedValueOnce({ id: "srv1", managementMode: "AGENT", agentTokenHash: stored });
    await expect(authenticateServerAgent(token)).resolves.toMatchObject({ id: "srv1" });
  });

  it("falls back without enqueueing when the Agent heartbeat is stale", async () => {
    mocks.serverFindUnique.mockResolvedValueOnce({
      managementMode: "AGENT",
      agentLastSeenAt: new Date(Date.now() - 10 * 60_000),
    });
    await expect(executeCommandWithAgent({ serverId: "srv1", command: "uptime", timeoutMs: 1000 })).resolves.toBeNull();
    expect(mocks.agentJobCreate).not.toHaveBeenCalled();
  });

  it("removes Agent files before stopping its own systemd service", () => {
    const disableAt = AGENT_CLEANUP_COMMAND.indexOf("systemctl disable ");
    const removeUnitAt = AGENT_CLEANUP_COMMAND.indexOf("rm -f /etc/systemd/system/vcontrolhub-agent.service");
    const removeAgentAt = AGENT_CLEANUP_COMMAND.indexOf("rm -rf /opt/vcontrolhub-agent");
    const reloadAt = AGENT_CLEANUP_COMMAND.indexOf("systemctl daemon-reload");
    const stopAt = AGENT_CLEANUP_COMMAND.indexOf("systemctl stop vcontrolhub-agent.service");

    expect(disableAt).toBeGreaterThanOrEqual(0);
    expect(removeUnitAt).toBeGreaterThan(disableAt);
    expect(removeAgentAt).toBeGreaterThan(removeUnitAt);
    expect(reloadAt).toBeGreaterThan(removeAgentAt);
    expect(stopAt).toBeGreaterThan(reloadAt);
    expect(AGENT_CLEANUP_COMMAND).not.toContain("disable --now");
  });
});
