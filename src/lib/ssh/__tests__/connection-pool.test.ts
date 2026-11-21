/** @vitest-environment node */
import type { EventEmitter as EventEmitterType } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connectCount: 0, endCount: 0, sftpOpenCount: 0, sftpEndCount: 0, read: vi.fn(), lastConfig: null as Record<string, unknown> | null }));

vi.mock("ssh2", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeClient extends EventEmitter {
    connect(config: Record<string, unknown>) {
      state.connectCount += 1;
      state.lastConfig = config;
      queueMicrotask(() => this.emit("ready"));
      return this;
    }
    exec(_command: string, callback: (error: Error | undefined, stream: EventEmitterType & { stderr: EventEmitterType }) => void) {
      const stream = new EventEmitter() as EventEmitterType & { stderr: EventEmitterType };
      stream.stderr = new EventEmitter();
      callback(undefined, stream);
      queueMicrotask(() => {
        stream.emit("data", Buffer.from("ok"));
        stream.emit("close", 0);
      });
    }
    sftp(callback: (error: Error | undefined, sftp: {
      opendir: (path: string, done: (error: undefined, handle: Buffer) => void) => void;
      readdir: (path: string, done: (error: Error | undefined, entries: unknown[]) => void) => void;
      createReadStream: typeof state.read;
      end: () => void;
    }) => void) {
      state.sftpOpenCount += 1;
      callback(undefined, {
        opendir: (_path, done) => done(undefined, Buffer.from("handle")),
        createReadStream: state.read,
        readdir: (_path, done) => done(Object.assign(new Error("EOF"), { code: 1 }), []),
        end: () => { state.sftpEndCount += 1; },
      });
    }
    end() {
      state.endCount += 1;
      this.emit("close");
    }
  }
  return { Client: FakeClient };
});

const { agent, findServer, acquireLock, releaseLock } = vi.hoisted(() => ({
  agent: vi.fn(), findServer: vi.fn(), acquireLock: vi.fn(), releaseLock: vi.fn(),
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: acquireLock }));
vi.mock("@/lib/db", () => ({ prisma: { server: { findUnique: findServer } } }));
vi.mock("@/lib/server/agent-service", () => ({ executeCommandWithAgent: agent }));

import { buildSshParamsFromServer, closeSshPool, execRemoteCommand, listRemoteDirectory, readRemoteFile } from "../client";

describe("SSH connection pool", () => {
  afterEach(async () => {
    await closeSshPool();
    state.connectCount = 0;
    state.endCount = 0;
    state.sftpOpenCount = 0;
    state.sftpEndCount = 0;
  });

  it("uses the selected Agent for operations and only falls back before dispatch", async () => {
    const target = { host: "203.0.113.10", port: 22, username: "ops", password: "test", hostKeySha256: "SHA256:test",
      agentServerId: "test-node", preferAgent: true, command: "uptime" };
    agent.mockResolvedValueOnce({ stdout: "", stderr: "operation failed", exitCode: 9 });
    expect((await execRemoteCommand(target)).exitCode).toBe(9);
    agent.mockRejectedValueOnce(new Error("acknowledgement lost"));
    await expect(execRemoteCommand(target)).rejects.toThrow("acknowledgement lost");
    agent.mockResolvedValueOnce(null);
    await expect(execRemoteCommand({ ...target, hostKeySha256: null })).rejects.toThrow();
    expect(state.connectCount).toBe(0);
    agent.mockResolvedValueOnce(null);
    findServer.mockResolvedValueOnce(null);
    await expect(execRemoteCommand(target)).rejects.toThrow();
    expect(state.connectCount).toBe(0);
    agent.mockResolvedValueOnce(null);
    findServer.mockResolvedValueOnce({ ...target, id: "test-node", operatingSystem: "LINUX", managementMode: "AGENT", connectionType: "PASSWORD" });
    await execRemoteCommand(target);
    expect(state.connectCount).toBe(1);
  });

  it("checks the authorized customer and Agent token when a claimed identity falls back to SSH", async () => {
    const server = { id: "srv", teamId: "old", agentTokenHash: "token", host: "vps", port: 22,
      username: "ops", password: "test", hostKeySha256: "pin", operatingSystem: "LINUX",
      managementMode: "AGENT", connectionType: "PASSWORD", sshKeyId: null };
    const target = await buildSshParamsFromServer(server, null, "old");
    acquireLock.mockResolvedValueOnce(releaseLock);
    agent.mockResolvedValueOnce(null);
    findServer.mockResolvedValueOnce(null);
    await expect(execRemoteCommand({ ...target, preferAgent: true, command: "uptime" })).rejects.toThrow();
    expect(agent).toHaveBeenCalledWith(expect.objectContaining({ expectedIdentity: expect.objectContaining({ teamId: "old", tokenHash: "token" }) }));
    expect(findServer).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: "srv", teamId: "old", agentTokenHash: "token", host: "vps", hostKeySha256: "pin",
    }) }));
    expect(state.connectCount).toBe(0);
  });

  it("checks the owner after a concurrent transfer releases its lock and holds that lock through dispatch", async () => {
    const target = { host: "host", port: 22, username: "ops", password: "pw", hostKeySha256: "pin",
      expectedIdentity: { serverId: "srv", teamId: "old", tokenHash: null }, command: "uptime" };
    const lock = Promise.withResolvers<typeof releaseLock>();
    acquireLock.mockReturnValueOnce(lock.promise);
    const pending = execRemoteCommand(target);
    await vi.waitFor(() => expect(acquireLock).toHaveBeenCalledWith("server-delete", "srv"));
    expect(state.connectCount).toBe(0);
    findServer.mockResolvedValueOnce(null);
    lock.resolve(releaseLock);
    await expect(pending).rejects.toThrow();
    expect(state.connectCount).toBe(0);
    expect(releaseLock).toHaveBeenCalled();

    let released = false;
    acquireLock.mockResolvedValueOnce(() => { released = true; });
    findServer.mockImplementation(async () => {
      expect(released).toBe(false);
      return { id: "srv" };
    });
    await expect(execRemoteCommand(target)).resolves.toMatchObject({ exitCode: 0 });
    expect(released).toBe(true);
  });

  it("rejects persisted SSH credentials without a pin before dialing", async () => {
    const params = await buildSshParamsFromServer({ id: "srv", teamId: "a", operatingSystem: "LINUX", managementMode: "DIRECT",
      connectionType: "PASSWORD", sshKeyId: null, password: "secret", host: "vps", port: 22, username: "ops", hostKeySha256: null });
    await expect(execRemoteCommand({ ...params, command: "uptime" })).rejects.toThrow();
    await expect(listRemoteDirectory({ ...params, remotePath: "/" })).rejects.toThrow();
    expect(state.connectCount).toBe(0);
  });

  it("keeps pooled connections alive, so one dropped silently is closed and replaced (C-2)", async () => {
    // A pooled connection idles up to ten minutes. Without keepalives one that
    // a NAT or firewall dropped silently was found dead only by the next
    // request, which stalled until TCP gave up (often 15 minutes or more).
    await execRemoteCommand({ host: "203.0.113.10", port: 22, username: "root", password: "secret", command: "uptime" });
    expect(state.lastConfig).toMatchObject({ keepaliveInterval: 15_000, keepaliveCountMax: 4 });
  });

  it("reuses a ready SSH connection for commands with identical credentials", async () => {
    const connection = { host: "203.0.113.10", port: 22, username: "root", password: "secret" };
    await expect(execRemoteCommand({ ...connection, command: "first" })).resolves.toMatchObject({ stdout: "ok", exitCode: 0 });
    await expect(execRemoteCommand({ ...connection, command: "second" })).resolves.toMatchObject({ stdout: "ok", exitCode: 0 });
    expect(state.connectCount).toBe(1);
    expect(state.endCount).toBe(0);
  });

  it("closes every SFTP channel while retaining the pooled SSH connection", async () => {
    const connection = { host: "203.0.113.10", port: 22, username: "root", password: "secret" };
    for (let index = 0; index < 12; index += 1) {
      await expect(listRemoteDirectory({ ...connection, remotePath: "/root" })).resolves.toEqual([]);
    }
    expect(state.connectCount).toBe(1);
    expect(state.sftpOpenCount).toBe(12);
    expect(state.sftpEndCount).toBe(12);
    expect(state.endCount).toBe(0);
  });

  it("lets a progressing file read outlive the metadata deadline and a full idle window", async () => {
    vi.useFakeTimers();
    try {
      const input = new PassThrough();
      state.read.mockReturnValueOnce(input);
      const result = readRemoteFile({ host: "fixture", port: 22, username: "ops", password: "test", remotePath: "/data/file" });
      await vi.advanceTimersByTimeAsync(60_000);
      input.write("first ");
      await vi.advanceTimersByTimeAsync(90_000);
      input.end("last");
      expect((await result).toString()).toBe("first last");
      expect(state.sftpEndCount).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});
