import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), update: vi.fn(), createJob: vi.fn(),
  exec: vi.fn(), realpath: vi.fn(), dockerRequest: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  server: { findUnique: mocks.findUnique, update: mocks.update },
  serverAgentJob: { create: mocks.createJob },
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
import { executeCommandWithAgent, issueServerAgentToken, uninstallServerAgent } from "@/lib/server/agent-service";
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

  it("refuses Linux agent token issuance before updating credentials", async () => {
    await expect(issueServerAgentToken("win")).rejects.toThrow(/Linux/);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses agent commands even with a fresh agent heartbeat", async () => {
    await expect(executeCommandWithAgent({ serverId: "win", command: "uname", timeoutMs: 1 }))
      .rejects.toThrow(/Linux/);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it("refuses Linux agent uninstall without dispatch or credential changes", async () => {
    await expect(uninstallServerAgent("win")).rejects.toThrow(/Linux/);
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
