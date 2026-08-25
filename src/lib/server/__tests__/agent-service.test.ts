/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverFindUnique: vi.fn(),
  serverUpdate: vi.fn(),
  agentJobCreate: vi.fn(),
  agentJobUpdateMany: vi.fn(),
  agentJobFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: mocks.serverFindUnique, update: mocks.serverUpdate },
    serverAgentJob: {
      create: mocks.agentJobCreate,
      updateMany: mocks.agentJobUpdateMany,
      findUnique: mocks.agentJobFindUnique,
    },
  },
}));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));
vi.mock("../monitor", () => ({ MONITOR_SCRIPT: "echo metrics" }));

import {
  AGENT_CLEANUP_COMMAND,
  authenticateServerAgent,
  executeCommandWithAgent,
  heartbeatServerAgentJob,
  issueServerAgentToken,
} from "../agent-service";

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

  it("refreshes a claimed job lease and reports cancellation", async () => {
    mocks.agentJobUpdateMany.mockResolvedValueOnce({ count: 1 });
    await expect(heartbeatServerAgentJob({ serverId: "srv1", jobId: "job1" })).resolves.toBe(false);
    expect(mocks.agentJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job1", serverId: "srv1", status: "CLAIMED" },
    }));

    mocks.agentJobUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.agentJobFindUnique.mockResolvedValueOnce({ serverId: "srv1", status: "CANCELLED" });
    await expect(heartbeatServerAgentJob({ serverId: "srv1", jobId: "job1" })).resolves.toBe(true);
  });

  it("cancels a claimed job on control-plane timeout", async () => {
    vi.useFakeTimers();
    mocks.serverFindUnique.mockResolvedValueOnce({
      managementMode: "AGENT",
      agentLastSeenAt: new Date(),
    });
    mocks.agentJobCreate.mockResolvedValueOnce({ id: "job1" });
    mocks.agentJobFindUnique.mockResolvedValue({ id: "job1", status: "CLAIMED", stdout: null });
    mocks.agentJobUpdateMany.mockResolvedValueOnce({ count: 1 });
    const resultPromise = executeCommandWithAgent({ serverId: "srv1", command: "sleep 1", timeoutMs: 1 });
    await vi.advanceTimersByTimeAsync(11_001);
    await expect(resultPromise).resolves.toMatchObject({ exitCode: 124 });
    expect(mocks.agentJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "job1", status: { in: ["PENDING", "CLAIMED"] } }),
      data: expect.objectContaining({ status: "CANCELLED", exitCode: 124 }),
    }));
    vi.useRealTimers();
  });
});
