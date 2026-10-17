/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverFindUnique: vi.fn(),
  serverUpdate: vi.fn(),
  buildSshParamsFromServer: vi.fn(),
  execRemoteCommand: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: mocks.serverFindUnique, update: mocks.serverUpdate },
  },
}));
vi.mock("@/lib/ssh/client", () => ({
  buildSshParamsFromServer: mocks.buildSshParamsFromServer,
  execRemoteCommand: mocks.execRemoteCommand,
}));
vi.mock("../monitor", () => ({ MONITOR_SCRIPT: "echo metrics" }));
vi.mock("@/lib/config/env", () => ({
  config: { app: { baseUrl: "https://hub.example.com" } },
}));

import { AGENT_SSH_CLEANUP_SCRIPT, installServerAgent, uninstallServerAgent } from "../agent-service";

const linuxServer = {
  id: "srv1",
  operatingSystem: "LINUX",
  connectionType: "PASSWORD",
  password: "secret",
  sshKeyId: null,
  sshKey: null,
  agentLastSeenAt: null,
};

describe("Linux Agent install over SSH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSshParamsFromServer.mockResolvedValue({ host: "203.0.113.5" });
    mocks.serverUpdate.mockResolvedValue({ id: "srv1" });
  });

  it("runs as root or through passwordless sudo, checks its needs, and restarts a running Agent", async () => {
    mocks.serverFindUnique.mockResolvedValueOnce(linuxServer).mockResolvedValueOnce({ id: "srv1" });
    mocks.execRemoteCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(installServerAgent("srv1")).resolves.toEqual({ installed: true });

    const command = mocks.execRemoteCommand.mock.calls[0]?.[0]?.command as string;
    // ubuntu, opc, ec2-user… cannot write /opt or /etc/systemd themselves.
    expect(command.startsWith(`if [ "$(id -u)" -eq 0 ]; then sh -c '`)).toBe(true);
    expect(command).toContain("sudo -n sh -c '");
    expect(command).toContain("The Agent needs python3");
    expect(command).toContain("The Agent needs systemd");
    // `enable --now` left an installed Agent running with its revoked token.
    expect(command).toContain("systemctl restart vcontrolhub-agent.service");
    expect(command).not.toContain("enable --now");
  });

  it("records why an install failed", async () => {
    mocks.serverFindUnique.mockResolvedValueOnce(linuxServer).mockResolvedValueOnce({ id: "srv1" });
    mocks.execRemoteCommand.mockResolvedValueOnce({ stdout: "", stderr: "sudo: a password is required", exitCode: 1 });

    await expect(installServerAgent("srv1")).rejects.toThrow("sudo: a password is required");
    expect(mocks.serverUpdate).toHaveBeenLastCalledWith({
      where: { id: "srv1" },
      data: { agentLastError: "sudo: a password is required" },
    });
  });
});

describe("Linux Agent removal over SSH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSshParamsFromServer.mockResolvedValue({ host: "203.0.113.5" });
    mocks.serverUpdate.mockResolvedValue({ id: "srv1" });
  });

  it("reports what the removal actually did, and always revokes the token", async () => {
    mocks.serverFindUnique.mockResolvedValueOnce(linuxServer);
    mocks.execRemoteCommand.mockResolvedValueOnce({ stdout: "", stderr: "sudo: a password is required", exitCode: 1 });
    await expect(uninstallServerAgent("srv1")).resolves.toEqual({ removed: false });
    const command = mocks.execRemoteCommand.mock.calls[0]?.[0]?.command as string;
    expect(command).toContain("sudo -n sh -c '");
    expect(command).toContain(AGENT_SSH_CLEANUP_SCRIPT.slice(0, 40));
    // Synchronous: no detached nohup, so the exit code means something.
    expect(command).not.toContain("nohup");
    expect(mocks.serverUpdate).toHaveBeenCalledWith({ where: { id: "srv1" }, data: { agentTokenHash: null } });

    mocks.serverFindUnique.mockResolvedValueOnce(linuxServer);
    mocks.execRemoteCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    await expect(uninstallServerAgent("srv1")).resolves.toEqual({ removed: true });
  });
});
