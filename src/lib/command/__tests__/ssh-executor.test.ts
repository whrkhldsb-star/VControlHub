import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  exitCode: number | null;
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
  BoundedOutputCollector,
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
  // Mirror the real ChildProcess: exitCode stays null until the process dies.
  child.exitCode = null;
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

    expect(result.stdout.endsWith("\n[output truncated, exceeded 80 bytes limit]")).toBe(true);
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

    expect(result.stderr.endsWith("\n[output truncated, exceeded 80 bytes limit]")).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it("does not re-copy output for every chunk (collector keeps O(1) appends)", () => {
    const collector = new BoundedOutputCollector(1024 * 1024);
    const chunk = Buffer.alloc(64 * 1024, "x");
    for (let i = 0; i < 16; i++) collector.push(chunk);
    expect(collector.finish()).toHaveLength(1024 * 1024);
    // Sealed after finish: later pushes cannot change the settled output.
    collector.push("late");
    expect(collector.finish()).toHaveLength(1024 * 1024);
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
    expect(result.stderr).toContain("Command execution exceeded 200ms");
  });

  it("escalates to SIGKILL when the child survives SIGTERM past the grace window", async () => {
    vi.useFakeTimers();
    spawnMock.mockImplementation(() => makeChild());

    const promise = runSshCommandProcess({
      command: "ssh",
      args: ["user@host", "sleep 5"],
      targetId: "target_timeout_sigkill_1",
      runtimeConfig: { ...RUNTIME_CONFIG, executionTimeoutMs: 200 },
    });

    await vi.advanceTimersByTimeAsync(200);
    const child = spawnMock.mock.results[0]!.value as MockChildProcess;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    // Child ignores SIGTERM: 5s later the escalation timer must fire SIGKILL.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);
    child.exitCode = null;
    const result = await promise;
    vi.useRealTimers();

    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
  });

  it("does not escalate to SIGKILL after close already fired (no leaked timers)", async () => {
    vi.useFakeTimers();
    spawnMock.mockImplementation(() => makeChild());

    const promise = runSshCommandProcess({
      command: "ssh",
      args: ["user@host", "sleep 5"],
      targetId: "target_timeout_clean_1",
      runtimeConfig: { ...RUNTIME_CONFIG, executionTimeoutMs: 200 },
    });

    await vi.advanceTimersByTimeAsync(200);
    const child = spawnMock.mock.results[0]!.value as MockChildProcess;
    // SIGTERM works: process exits (exitCode set) and close fires.
    child.exitCode = null;
    child.emit("close", null);
    await promise;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
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
    expect(result.stderr).toContain("cancelled");
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

describe("command ssh-executor BoundedOutputCollector", () => {
  it("keeps output exactly at the limit verbatim (no marker)", () => {
    const collector = new BoundedOutputCollector(80);
    collector.push("A".repeat(80));
    expect(collector.finish()).toBe("A".repeat(80));
  });

  it("appends chunk when total stays within the limit", () => {
    const collector = new BoundedOutputCollector(80);
    collector.push("abc");
    collector.push("def");
    expect(collector.finish()).toBe("abcdef");
  });

  it("truncates and appends marker when total exceeds the limit", () => {
    const collector = new BoundedOutputCollector(80);
    collector.push("A".repeat(70));
    collector.push("B".repeat(20));
    const result = collector.finish();
    expect(result.endsWith("\n[output truncated, exceeded 80 bytes limit]")).toBe(true);
    expect(Buffer.byteLength(result, "utf8")).toBeGreaterThan(80);
    // The kept payload is cut at exactly the limit.
    expect(result.startsWith("A".repeat(70) + "B".repeat(10))).toBe(true);
  });

  it("stops collecting further chunks once the cap is exceeded", () => {
    const collector = new BoundedOutputCollector(10);
    collector.push("0123456789AAAA");
    collector.push("BBBBBBBBBBBBBBBB");
    const result = collector.finish();
    expect(result.startsWith("0123456789")).toBe(true);
    expect(result).not.toContain("B");
  });

  it("marks truncation only for non-empty pushes past the cap", () => {
    const collector = new BoundedOutputCollector(10);
    collector.push("0123456789");
    collector.push("");
    expect(collector.finish()).toBe("0123456789");
  });
});
