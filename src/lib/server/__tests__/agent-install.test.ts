/** @vitest-environment node */
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverFindUnique: vi.fn(),
  serverUpdate: vi.fn(),
  proof: { upsert: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  buildSshParamsFromServer: vi.fn(),
  execRemoteCommand: vi.fn(),
}));

vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: async () => async () => {} }));
vi.mock("@/lib/db", () => {
  const client = { server: { findUnique: mocks.serverFindUnique, update: mocks.serverUpdate, updateMany: mocks.serverUpdate }, setting: mocks.proof };
  return { prisma: { ...client, $transaction: (work: (tx: typeof client) => unknown) => work(client) } };
});
vi.mock("@/lib/ssh/client", () => ({
  buildSshParamsFromServer: mocks.buildSshParamsFromServer,
  execRemoteCommand: mocks.execRemoteCommand,
}));
vi.mock("../monitor", () => ({ MONITOR_SCRIPT: "echo metrics" }));
vi.mock("@/lib/config/env", () => ({
  config: { auth: { secret: "test-only-proof-key" }, app: { baseUrl: "https://hub.example.com" } },
}));

import { AGENT_SSH_CLEANUP_SCRIPT, authenticateServerAgent, installServerAgent, uninstallServerAgent } from "../agent-service";

const linuxServer = {
  id: "srv1",
  operatingSystem: "LINUX",
  connectionType: "PASSWORD",
  password: "secret",
  sshKeyId: null,
  sshKey: null,
  agentLastSeenAt: null,
  teamId: "team1",
  agentTokenHash: null,
  managementMode: "AGENT",
};

describe("Linux Agent install over SSH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSshParamsFromServer.mockResolvedValue({ host: "203.0.113.5" });
    mocks.serverFindUnique.mockReset().mockResolvedValue(null);
    mocks.execRemoteCommand.mockReset().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    mocks.serverUpdate.mockResolvedValue({ id: "srv1" });
    mocks.proof.deleteMany.mockResolvedValue({ count: 1 });
    mocks.proof.upsert.mockImplementation(async ({ create }) => {
      mocks.proof.findUnique.mockResolvedValue(create);
    });
  });

  it("runs as root or through passwordless sudo, checks its needs, and restarts a running Agent", async () => {
    mocks.serverFindUnique.mockResolvedValueOnce(linuxServer);
    mocks.execRemoteCommand.mockImplementationOnce(async ({ command }) => {
      const encoded = String(command).match(/[A-Za-z0-9+/=]{1000,}/)![0];
      const token = JSON.parse(Buffer.from(encoded, "base64").toString().match(/^TOKEN=(.+)$/m)![1]!);
      mocks.serverFindUnique.mockResolvedValueOnce(linuxServer).mockResolvedValueOnce(linuxServer);
      expect(await authenticateServerAgent(token)).toMatchObject({ id: "srv1" });
      mocks.serverFindUnique.mockResolvedValueOnce({ id: "srv1" });
      return { exitCode: 0 };
    });

    await expect(installServerAgent("srv1")).resolves.toEqual({ installed: true });

    const command = mocks.execRemoteCommand.mock.calls[0]?.[0]?.command as string;
    // ubuntu, opc, ec2-user… cannot write /opt or /etc/systemd themselves.
    expect(command.startsWith(`if [ "$(id -u)" -eq 0 ]; then sh -c '`)).toBe(true);
    expect(command).toContain("sudo -n sh -c '");
    expect(command).toContain("The Agent needs python3");
    expect(command).toContain("The Agent needs systemd");
    // `enable --now` left an installed Agent running with its revoked token.
    expect(command).toContain("systemctl restart vcontrolhub-agent.service");
    expect(command).toContain("Restart=on-failure");
    expect(command).not.toContain("enable --now");
    expect(mocks.execRemoteCommand.mock.invocationCallOrder[0]!).toBeLessThan(mocks.serverUpdate.mock.invocationCallOrder[0]!);
    expect(mocks.serverUpdate.mock.calls[0]![0].data.agentTokenHash).toEqual(expect.any(String));
  });

  it("records why an install failed", async () => {
    mocks.serverFindUnique.mockResolvedValueOnce(linuxServer);
    mocks.execRemoteCommand.mockResolvedValueOnce({ stdout: "", stderr: "sudo: a password is required", exitCode: 1 });

    await expect(installServerAgent("srv1")).rejects.toThrow("sudo: a password is required");
    expect(mocks.serverUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.serverUpdate).toHaveBeenCalledWith({
      where: { id: "srv1", teamId: "team1", managementMode: "AGENT", agentTokenHash: null },
      data: { agentLastError: "sudo: a password is required" },
    });
  });

  it.skipIf(process.platform === "win32")("restores the script, identity and unit together after a failed service restart", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vch-install-"));
    try {
      const agentDir = path.join(dir, "installation"), unit = path.join(dir, "unit");
      await mkdir(agentDir);
      await writeFile(path.join(agentDir, "agent.py"), "original agent");
      await writeFile(path.join(agentDir, "install-id"), "original identity");
      await writeFile(unit, "original unit");
      for (const [name, script] of Object.entries({
        systemctl: '#!/bin/sh\necho "$*" >> "$TEST_STATE"\n[ "$1" != restart ]',
        "systemd-run": "#!/bin/sh\nexit 0", id: "#!/bin/sh\necho 0",
      })) {
        await writeFile(path.join(dir, name), script);
        await chmod(path.join(dir, name), 0o755);
      }
      mocks.serverFindUnique.mockResolvedValueOnce(linuxServer);
      mocks.execRemoteCommand.mockImplementation(async ({ command }) => {
        const isolated = command.replaceAll("/opt/vcontrolhub-agent", agentDir)
          .replaceAll("/etc/systemd/system/vcontrolhub-agent.service", unit)
          .replaceAll("/run/vcontrolhub-agent-lifecycle.lock", path.join(dir, "lock"));
        try {
          await promisify(execFile)("sh", ["-c", isolated], { env: { ...process.env, PATH: dir + ":" + process.env.PATH, TEST_STATE: path.join(dir, "state") } });
          return { exitCode: 0 };
        } catch { return { exitCode: 1, stderr: "restart failed" }; }
      });
      await expect(installServerAgent("srv1")).rejects.toThrow("restart failed");
      expect(await readFile(path.join(agentDir, "install-id"), "utf8")).toBe("original identity");
      expect(await readFile(path.join(agentDir, "agent.py"), "utf8")).toBe("original agent");
      expect(await readFile(unit, "utf8")).toBe("original unit");
      expect(await readFile(path.join(dir, "state"), "utf8")).toContain("start vcontrolhub-agent.service");
      expect(mocks.proof.deleteMany).toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("keeps the existing token and drive pairings when the reinstall fails", async () => {
    mocks.serverFindUnique.mockResolvedValueOnce({ ...linuxServer, agentTokenHash: "hash-of-the-running-agent" });
    mocks.execRemoteCommand.mockResolvedValueOnce({ stdout: "", stderr: "python3: not found", exitCode: 127 });

    await expect(installServerAgent("srv1")).rejects.toThrow("python3: not found");
    expect(mocks.serverUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.serverUpdate).toHaveBeenCalledWith({
      where: { id: "srv1", teamId: "team1", managementMode: "AGENT", agentTokenHash: "hash-of-the-running-agent" },
      data: { agentLastError: "python3: not found" },
    });
  });

  it("keeps the existing token and drive pairings when the server cannot be reached at all", async () => {
    mocks.serverFindUnique.mockResolvedValueOnce({ ...linuxServer, agentTokenHash: "hash-of-the-running-agent" });
    mocks.execRemoteCommand.mockRejectedValueOnce(new Error("connect ETIMEDOUT 203.0.113.5:22"));

    await expect(installServerAgent("srv1")).rejects.toThrow("connect ETIMEDOUT");
    expect(mocks.serverUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.serverUpdate).toHaveBeenCalledWith({
      where: { id: "srv1", teamId: "team1", managementMode: "AGENT", agentTokenHash: "hash-of-the-running-agent" },
      data: { agentLastError: "connect ETIMEDOUT 203.0.113.5:22" },
    });
  });

  it("refuses a node without an SSH credential before its token is replaced", async () => {
    // The install script travels over SSH. Without a credential it was handed to the running Agent, whose token had
    // just been revoked: the Agent could not fetch the job and stayed locked out.
    mocks.serverFindUnique.mockResolvedValueOnce({ ...linuxServer, password: null, managementMode: "AGENT", agentTokenHash: "hash-of-the-running-agent" });

    await expect(installServerAgent("srv1")).rejects.toThrow(/SSH/);
    expect(mocks.serverUpdate).not.toHaveBeenCalled();
    expect(mocks.execRemoteCommand).not.toHaveBeenCalled();
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
    expect(mocks.serverUpdate).toHaveBeenCalledWith({ where: { id: "srv1", managementMode: "AGENT" }, data: { agentTokenHash: null } });

    mocks.serverFindUnique.mockResolvedValueOnce(linuxServer);
    mocks.execRemoteCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    await expect(uninstallServerAgent("srv1")).resolves.toEqual({ removed: true });
  });
});
