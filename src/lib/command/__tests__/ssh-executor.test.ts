import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const mockedModule = {
    ...actual,
    spawn: spawnMock,
  };

  return {
    __esModule: true,
    ...mockedModule,
    default: mockedModule,
  };
});

import {
  appendBoundedOutput,
  cancelRunningCommandChild,
  markCommandTargetCancelled,
  runSshCommandProcess,
} from "../ssh-executor";

const RUNTIME_CONFIG = {
  executionTimeoutMs: 1000,
  outputLimitBytes: 80,
};

function makeChild(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => true);
  return child;
}

describe("command ssh-executor adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves with exitCode 0 and joined stdout/stderr when child emits data + close 0", async () => {
    spawnMock.mockImplementation(() => {
      const child = makeChild();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("hello "));
        child.stdout.emit("data", Buffer.from("world\n"));
        child.emit("close", 0);
      });
      return child;
    });

    const result = await runSshCommandProcess({
      command: "ssh",
      args: ["user@host", "uptime"],
      env: process.env,
      targetId: "target_ok_1",
      runtimeConfig: RUNTIME_CONFIG,
    });

    expect(result).toEqual({
      stdout: "hello world\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      cancelled: false,
    });
    expect(spawnMock).toHaveBeenCalledWith(
      "ssh",
      ["user@host", "uptime"],
      expect.objectContaining({ env: process.env }),
    );
  });

  it("caps stdout at outputLimitBytes and appends a truncation marker", async () => {
    spawnMock.mockImplementation(() => {
      const child = makeChild();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("A".repeat(50)));
        child.stdout.emit("data", Buffer.from("B".repeat(50)));
        child.stdout.emit("data", Buffer.from("C".repeat(50)));
        child.emit("close", 0);
      });
      return child;
    });

    const result = await runSshCommandProcess({
      command: "ssh",
      args: ["user@host", "seq"],
      targetId: "target_cap_out_1",
      runtimeConfig: RUNTIME_CONFIG,
    });

    expect(result.stdout.endsWith("\n[输出已截断，超过 80 字节限制]")).toBe(true);
  });

  it("caps stderr at outputLimitBytes and appends a truncation marker", async () => {
    spawnMock.mockImplementation(() => {
      const child = makeChild();
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("X".repeat(60)));
        child.stderr.emit("data", Buffer.from("Y".repeat(60)));
        child.emit("close", 1);
      });
      return child;
    });

    const result = await runSshCommandProcess({
      command: "ssh",
      args: ["user@host", "false"],
      targetId: "target_cap_err_1",
      runtimeConfig: RUNTIME_CONFIG,
    });

    expect(result.stderr.endsWith("\n[输出已截断，超过 80 字节限制]")).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it("kills the child and reports exitCode 124 + timedOut=true when the timeout fires", async () => {
    vi.useFakeTimers();
    spawnMock.mockImplementation(() => {
      return makeChild();
    });

    const promise = runSshCommandProcess({
      command: "ssh",
      args: ["user@host", "sleep 5"],
      targetId: "target_timeout_1",
      runtimeConfig: { ...RUNTIME_CONFIG, executionTimeoutMs: 200 },
    });

    await vi.advanceTimersByTimeAsync(200);
    const child = spawnMock.mock.results[0]!.value as MockChildProcess;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("close", null);
    const result = await promise;
    vi.useRealTimers();

    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.stderr).toContain("命令执行超过 200ms");
  });

  it("reports exitCode 130 + cancelled=true when the target was pre-marked cancelled", async () => {
    markCommandTargetCancelled("target_cancel_1");
    spawnMock.mockImplementation(() => {
      const child = makeChild();
      queueMicrotask(() => {
        child.emit("close", null);
      });
      return child;
    });

    const result = await runSshCommandProcess({
      command: "ssh",
      args: ["user@host", "echo"],
      targetId: "target_cancel_1",
      runtimeConfig: RUNTIME_CONFIG,
    });

    expect(result.exitCode).toBe(130);
    expect(result.cancelled).toBe(true);
    expect(result.stderr).toContain("命令已被取消");
  });

  it("rejects with the sshpass-missing message when spawn emits an ENOENT error", async () => {
    spawnMock.mockImplementation(() => {
      const child = makeChild();
      queueMicrotask(() => {
        const err = Object.assign(new Error("spawn sshpass ENOENT"), { code: "ENOENT" });
        child.emit("error", err);
      });
      return child;
    });

    await expect(
      runSshCommandProcess({
        command: "sshpass",
        args: ["-e", "ssh", "user@host", "uptime"],
        targetId: "target_enoent_1",
        runtimeConfig: RUNTIME_CONFIG,
      }),
    ).rejects.toThrow(/sshpass/);
  });

  it("cancelRunningCommandChild returns true and forwards SIGTERM when a live child is registered", () => {
    spawnMock.mockImplementation(() => {
      const child = makeChild();
      return child;
    });

    runSshCommandProcess({
      command: "ssh",
      args: ["user@host", "long"],
      targetId: "target_kill_1",
      runtimeConfig: { ...RUNTIME_CONFIG, executionTimeoutMs: 10_000 },
    });

    // Wait for spawnMock to have produced a child we can inspect
    const child = spawnMock.mock.results[0]!.value as MockChildProcess;
    markCommandTargetCancelled("target_kill_1");
    const killed = cancelRunningCommandChild("target_kill_1");
    expect(killed).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("command ssh-executor appendBoundedOutput", () => {
  it("returns current unchanged when already at the limit", () => {
    const initial = "A".repeat(80);
    const next = appendBoundedOutput(initial, "more data", 80);
    expect(next).toBe(initial);
  });

  it("appends chunk when total stays within the limit", () => {
    const next = appendBoundedOutput("abc", "def", 80);
    expect(next).toBe("abcdef");
  });

  it("truncates and appends marker when total exceeds the limit", () => {
    const next = appendBoundedOutput("A".repeat(70), "B".repeat(20), 80);
    expect(next.endsWith("\n[输出已截断，超过 80 字节限制]")).toBe(true);
    expect(Buffer.byteLength(next, "utf8")).toBeGreaterThan(80);
  });
});
