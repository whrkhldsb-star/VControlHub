import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

type Prompt = { prompt?: string; echo?: boolean };
type MockStream = EventEmitter & { stderr: EventEmitter };
type MockClient = EventEmitter & {
  config: unknown;
  ended: boolean;
  exec: (command: string, cb: (error: Error | null, stream: MockStream) => void) => unknown;
};

const { connectMock, instances } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  instances: [] as MockClient[],
}));

vi.mock("ssh2", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class MockSsh2Client extends Emitter {
    config: unknown;
    ended = false;

    constructor() {
      super();
      instances.push(this as unknown as MockClient);
    }

    connect(config: unknown) {
      this.config = config;
      connectMock(config);
      return this;
    }

    exec(_command: string, _cb: (error: Error | null, stream: MockStream) => void) {
      return this;
    }

    end() {
      this.ended = true;
    }
  }
  return { Client: MockSsh2Client };
});

import { runSsh2Command } from "../ssh2-executor";
import { SshHostKeyChangedError } from "@/lib/ssh/host-key";

const RUNTIME_CONFIG = { executionTimeoutMs: 60_000, outputLimitBytes: 4096 };

function input(overrides: Partial<Parameters<typeof runSsh2Command>[0]> = {}) {
  return {
    host: "10.0.0.9",
    port: 22,
    username: "root",
    password: "super-secret",
    command: "uptime",
    runtimeConfig: RUNTIME_CONFIG,
    ...overrides,
  };
}

/**
 * Drive one execution: hand the executor a client whose exec() yields a
 * captured stream, fire "ready", and return handles the test can push to.
 */
async function startExecution(overrides: Partial<Parameters<typeof runSsh2Command>[0]> = {}) {
  const promise = runSsh2Command(input(overrides));
  await vi.waitFor(() => expect(instances.length).toBeGreaterThan(0));
  const client = instances[instances.length - 1]!;
  const streamWaiter = new Promise<MockStream>((resolve) => {
    client.exec = (_command: string, cb: (error: Error | null, s: MockStream) => void) => {
      const s = new EventEmitter() as MockStream;
      s.stderr = new EventEmitter();
      resolve(s);
      cb(null, s);
      return client;
    };
  });
  client.emit("ready");
  return { promise, client, stream: await streamWaiter };
}

describe("ssh2-executor (Windows password transport)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instances.length = 0;
    vi.useRealTimers();
  });

  it("returns joined stdout/stderr with the remote exit code on stream close", async () => {
    const { promise, stream } = await startExecution();
    stream.emit("data", Buffer.from("out-"));
    stream.emit("data", Buffer.from("chunk"));
    stream.stderr.emit("data", Buffer.from("warn"));
    stream.emit("close", 0);

    await expect(promise).resolves.toMatchObject({
      stdout: "out-chunk",
      stderr: "warn",
      exitCode: 0,
      timedOut: false,
      cancelled: false,
    });
  });

  it("reports exitCode 124 and ends the client when the timeout fires", async () => {
    vi.useFakeTimers();
    const promise = runSsh2Command(input({ runtimeConfig: { executionTimeoutMs: 200, outputLimitBytes: 4096 } }));
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(instances.length).toBeGreaterThan(0));
    const client = instances[instances.length - 1]!;
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.stderr).toContain("Command execution exceeded 200ms");
    expect(client.ended).toBe(true);
    vi.useRealTimers();
  });

  it("answers a single hidden password prompt with the stored password", async () => {
    const { promise, client, stream } = await startExecution({ command: "long" });
    const answers = new Promise<string[]>((resolve) => {
      client.emit(
        "keyboard-interactive",
        "Password",
        "",
        "",
        [{ prompt: "Enter your password: ", echo: false }] as Prompt[],
        (reply: string[]) => resolve(reply),
      );
    });
    await expect(answers).resolves.toEqual(["super-secret"]);
    stream.emit("close", 0);
    await expect(promise).resolves.toMatchObject({ exitCode: 0 });
  });

  it("never sends the password to a multi-prompt challenge (MFA)", async () => {
    const { promise, client, stream } = await startExecution({ command: "long" });
    const answers = new Promise<string[]>((resolve) => {
      client.emit(
        "keyboard-interactive",
        "Verification",
        "",
        "",
        [
          { prompt: "Verification code: ", echo: true },
          { prompt: "Password: ", echo: false },
        ] as Prompt[],
        (reply: string[]) => resolve(reply),
      );
    });
    await expect(answers).resolves.toEqual(["", ""]);
    stream.emit("close", 0);
    await promise;
  });

  it("never sends the password to a visible non-password prompt", async () => {
    const { promise, client, stream } = await startExecution({ command: "long" });
    const answers = new Promise<string[]>((resolve) => {
      client.emit(
        "keyboard-interactive",
        "Challenge",
        "",
        "",
        [{ prompt: "Enter the 6-digit token: ", echo: true }] as Prompt[],
        (reply: string[]) => resolve(reply),
      );
    });
    await expect(answers).resolves.toEqual([""]);
    stream.emit("close", 0);
    await promise;
  });

  it("never sends the password to a single hidden non-password prompt", async () => {
    const { promise, client, stream } = await startExecution({ command: "long" });
    const answers = new Promise<string[]>((resolve) => {
      client.emit(
        "keyboard-interactive",
        "OTP",
        "",
        "",
        [{ prompt: "One-time code: ", echo: false }] as Prompt[],
        (reply: string[]) => resolve(reply),
      );
    });
    await expect(answers).resolves.toEqual([""]);
    stream.emit("close", 0);
    await promise;
  });

  it("maps host-key verification failures to SshHostKeyChangedError", async () => {
    const run = runSsh2Command(input());
    await vi.waitFor(() => expect(instances.length).toBeGreaterThan(0));
    instances[instances.length - 1]!.emit("error", new Error("(Handshake failed) Host key verification failed"));
    await expect(run).rejects.toBeInstanceOf(SshHostKeyChangedError);
  });

  it("truncates oversized stream output with a marker", async () => {
    const { promise, stream } = await startExecution({
      runtimeConfig: { executionTimeoutMs: 60_000, outputLimitBytes: 32 },
    });
    stream.emit("data", Buffer.from("A".repeat(20)));
    stream.emit("data", Buffer.from("B".repeat(20)));
    stream.emit("close", 0);
    const result = await promise;
    expect(result.stdout.endsWith("\n[output truncated, exceeded 32 bytes limit]")).toBe(true);
  });
});
