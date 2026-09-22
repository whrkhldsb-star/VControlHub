import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), update: vi.fn(), createJob: vi.fn(),
  jobFindUnique: vi.fn(), jobUpdateMany: vi.fn(),
  exec: vi.fn(), realpath: vi.fn(), dockerRequest: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  server: { findUnique: mocks.findUnique, update: mocks.update },
  serverAgentJob: { create: mocks.createJob, findUnique: mocks.jobFindUnique, updateMany: mocks.jobUpdateMany },
} }));
vi.mock("@/lib/ssh/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ssh/client")>(),
  execRemoteCommand: mocks.exec, resolveRemoteRealPath: mocks.realpath,
}));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => false }));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: async () => async () => {} }));
vi.mock("@/lib/docker/engine-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/docker/engine-client")>(),
  dockerRequest: mocks.dockerRequest,
}));

import { dockerExec } from "@/lib/quick-service/docker-cli";
import { assertSftpPathAccess } from "@/lib/ssh/sftp-access-control";
import { runComposeProjectAction } from "@/lib/docker/compose-projects";
import {
  AGENT_WINDOWS_CLEANUP_COMMAND,
  executeCommandWithAgent,
  installServerAgent,
  issueServerAgentToken,
  uninstallServerAgent,
} from "@/lib/server/agent-service";
import type { SessionPayload } from "@/lib/auth/session";

const windows = {
  id: "win", name: "Windows", operatingSystem: "WINDOWS", enabled: true,
  host: "192.0.2.10", port: 3389, username: "Administrator", sshKeyId: null,
  password: null, sshKey: null, managementMode: "AGENT", agentLastSeenAt: new Date(),
};

describe("Windows rejects Linux-only operations before side effects", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findUnique.mockResolvedValue(windows);
  });

  it("rejects remote quick-service Docker through the real SSH guard", async () => {
    await expect(dockerExec({ kind: "remote", serverId: "win" }, ["ps"]))
      .rejects.toThrow(/Linux/);
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("rejects SFTP before resolving remote paths", async () => {
    await expect(assertSftpPathAccess({ session: {} as SessionPayload, serverId: "win", paths: ["/home/Administrator"] }))
      .rejects.toThrow(/Linux/);
    expect(mocks.realpath).not.toHaveBeenCalled();
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ operatingSystem: true }) }));
  });

  it("rejects compose CLI even when an earlier engine listing succeeded", async () => {
    mocks.dockerRequest.mockResolvedValue({ result: { ok: true, status: 200, data: [{
      Id: "container", Names: ["/site-web-1"], State: "running", Status: "Up", Image: "nginx",
      Labels: { "com.docker.compose.project": "site", "com.docker.compose.service": "web" },
    }] }, scope: { scope: "remote-vps", serverId: "win" } });
    await expect(runComposeProjectAction({ project: "site", action: "up", serverId: "win" }))
      .rejects.toThrow(/Linux/);
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.dockerRequest).toHaveBeenCalledTimes(1);
  });
});

describe("Windows agent support", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findUnique.mockResolvedValue(windows);
  });

  it("issues an agent token for Windows nodes without touching credentials", async () => {
    mocks.update.mockResolvedValueOnce({ id: "win" });
    const token = await issueServerAgentToken("win");
    expect(token).toMatch(/^vca_win_/);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0]?.[0]?.data).not.toHaveProperty("password");
  });

  it("dispatches agent jobs for Windows nodes with a fresh heartbeat", async () => {
    mocks.createJob.mockResolvedValueOnce({ id: "job1" });
    mocks.jobFindUnique.mockResolvedValueOnce({ id: "job1", status: "COMPLETED", stdout: "ok", stderr: "", exitCode: 0 });
    const result = await executeCommandWithAgent({ serverId: "win", command: "ver", timeoutMs: 5_000 });
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ stdout: "ok", exitCode: 0 });
  });

  it("uninstalls the Windows agent through a dispatched job and always revokes the token", async () => {
    mocks.createJob.mockResolvedValueOnce({ id: "cleanup-job" });
    mocks.jobFindUnique.mockResolvedValueOnce({ id: "cleanup-job", status: "COMPLETED", stdout: "", stderr: "", exitCode: 0 });
    mocks.update.mockResolvedValueOnce({ id: "win" });
    const result = await uninstallServerAgent("win");
    expect(result).toEqual({ removed: true });
    // The dispatched cleanup command is the Windows self-removal command.
    expect(mocks.createJob.mock.calls[0]?.[0]?.data.command).toBe(AGENT_WINDOWS_CLEANUP_COMMAND);
    // Never attempts the Linux SSH push/fallback for Windows.
    expect(mocks.exec).not.toHaveBeenCalled();
    // Token revoked even when the dispatch fails.
    const revokeCalls = mocks.update.mock.calls.filter((call) => call[0]?.data?.agentTokenHash === null);
    expect(revokeCalls).toHaveLength(1);
  });

  it("revokes the Windows agent token even when the agent is offline", async () => {
    mocks.findUnique.mockResolvedValueOnce({ ...windows, agentLastSeenAt: new Date(Date.now() - 10 * 60_000) });
    mocks.update.mockResolvedValueOnce({ id: "win" });
    const result = await uninstallServerAgent("win");
    expect(result).toEqual({ removed: false });
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { agentTokenHash: null } }));
  });

  it("refuses the SSH-based Linux installer for Windows nodes before issuing anything", async () => {
    await expect(installServerAgent("win")).rejects.toThrow(/Windows/);
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
