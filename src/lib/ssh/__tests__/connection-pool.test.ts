/** @vitest-environment node */
import type { EventEmitter as EventEmitterType } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connectCount: 0, endCount: 0, sftpOpenCount: 0, sftpEndCount: 0, lastConfig: null as Record<string, unknown> | null }));

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
      readdir: (path: string, done: (error: Error | undefined, entries: unknown[]) => void) => void;
      end: () => void;
    }) => void) {
      state.sftpOpenCount += 1;
      callback(undefined, {
        readdir: (_path, done) => done(undefined, []),
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

import { closeSshPool, execRemoteCommand, listRemoteDirectory } from "../client";

describe("SSH connection pool", () => {
  afterEach(async () => {
    await closeSshPool();
    state.connectCount = 0;
    state.endCount = 0;
    state.sftpOpenCount = 0;
    state.sftpEndCount = 0;
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
});
