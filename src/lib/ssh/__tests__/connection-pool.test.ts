/** @vitest-environment node */
import type { EventEmitter as EventEmitterType } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connectCount: 0, endCount: 0 }));

vi.mock("ssh2", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeClient extends EventEmitter {
    connect() {
      state.connectCount += 1;
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
    end() {
      state.endCount += 1;
      this.emit("close");
    }
  }
  return { Client: FakeClient };
});

import { closeSshPool, execRemoteCommand } from "../client";

describe("SSH connection pool", () => {
  afterEach(async () => {
    await closeSshPool();
    state.connectCount = 0;
    state.endCount = 0;
  });

  it("reuses a ready SSH connection for commands with identical credentials", async () => {
    const connection = { host: "203.0.113.10", port: 22, username: "root", password: "secret" };
    await expect(execRemoteCommand({ ...connection, command: "first" })).resolves.toMatchObject({ stdout: "ok", exitCode: 0 });
    await expect(execRemoteCommand({ ...connection, command: "second" })).resolves.toMatchObject({ stdout: "ok", exitCode: 0 });
    expect(state.connectCount).toBe(1);
    expect(state.endCount).toBe(0);
  });
});
