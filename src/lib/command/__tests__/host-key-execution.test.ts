import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ scanPinnedKnownHost: vi.fn(), runSshCommandProcess: vi.fn(), runtime: vi.fn() }));
vi.mock("@/lib/ssh/known-hosts", () => ({ scanPinnedKnownHost: mocks.scanPinnedKnownHost }));
vi.mock("../ssh-executor", () => ({ runSshCommandProcess: mocks.runSshCommandProcess, cancelRunningCommandChild: vi.fn(), markCommandTargetCancelled: vi.fn() }));
vi.mock("@/lib/runtime-settings/service", () => ({ getCommandRuntimeConfig: mocks.runtime }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { executeCommandOverSsh } from "../service-execution";

describe("command OpenSSH host-key pin execution", () => {
  afterEach(() => vi.clearAllMocks());

  it("writes a matched known_hosts line and uses it for the actual key-based SSH process", async () => {
    mocks.scanPinnedKnownHost.mockResolvedValue("example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEexample");
    mocks.runtime.mockResolvedValue({ executionTimeoutMs: 1000, outputLimitBytes: 1000, staleRunningAfterMs: 1000, executionHeartbeatMs: 100 });
    mocks.runSshCommandProcess.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0, timedOut: false, cancelled: false });
    await executeCommandOverSsh({ host: "example.com", port: 22, username: "root", privateKey: "PRIVATE KEY", command: "uptime", hostKeySha256: "SHA256:pin" });
    expect(mocks.scanPinnedKnownHost).toHaveBeenCalledWith({ host: "example.com", port: 22, expectedFingerprint: "SHA256:pin" });
    const call = mocks.runSshCommandProcess.mock.calls[0]![0];
    expect(call.command).toBe("ssh");
    expect(call.args).toContain("StrictHostKeyChecking=yes");
    expect(call.args.some((arg: string) => arg.startsWith("UserKnownHostsFile=") && !arg.endsWith("/dev/null"))).toBe(true);
  });

  it("keeps accept-new only for explicitly unpinned bootstrap connections", async () => {
    mocks.runtime.mockResolvedValue({ executionTimeoutMs: 1000, outputLimitBytes: 1000, staleRunningAfterMs: 1000, executionHeartbeatMs: 100 });
    mocks.runSshCommandProcess.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0, timedOut: false, cancelled: false });
    await executeCommandOverSsh({ host: "example.com", port: 22, username: "root", password: "secret", command: "uptime" });
    expect(mocks.scanPinnedKnownHost).not.toHaveBeenCalled();
    const call = mocks.runSshCommandProcess.mock.calls[0]![0];
    expect(call.command).toBe("sshpass");
    expect(call.args).toContain("StrictHostKeyChecking=accept-new");
    expect(call.args).toContain("UserKnownHostsFile=/dev/null");
  });
});
