/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverFindUnique: vi.fn(),
  serverUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: mocks.serverFindUnique, update: mocks.serverUpdate },
  },
}));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));
vi.mock("../monitor", () => ({ MONITOR_SCRIPT: "echo metrics" }));
vi.mock("@/lib/config/env", () => ({
  config: { app: { baseUrl: "https://hub.example.com" } },
}));

import {
  AGENT_WINDOWS_CLEANUP_COMMAND,
  AGENT_WINDOWS_TASK_NAME,
  buildAgentPowerShell,
  buildWindowsAgentInstaller,
  prepareWindowsAgentInstall,
} from "../agent-service";

const HUB = "https://hub.example.com";
const TOKEN = "vca_win_abcdefghijklmnopqrstuvwxyz0123456789";

describe("Windows agent script generation", () => {
  it("embeds the poll endpoint, bearer token, and UTF-8 command shell", () => {
    const script = buildAgentPowerShell(HUB, TOKEN);
    expect(script).toContain(`$ENDPOINT = ${JSON.stringify("https://hub.example.com/api/agent/v1/poll")}`);
    expect(script).toContain(`$TOKEN = ${JSON.stringify(TOKEN)}`);
    // Commands run through cmd with a UTF-8 codepage so output round-trips.
    expect(script).toContain("chcp 65001");
    expect(script).toContain("StandardOutputEncoding");
    // Long jobs are killed tree-wide (cmd children included) on timeout.
    expect(script).toContain("taskkill /PID ");
    // Hub protocol caps exitCode at 255; Windows exit codes are 32-bit.
    expect(script).toContain("$exitCode -gt 255");
    // Declared capabilities match what the agents actually implement.
    expect(script).toContain("@('metrics', 'command')");
    expect(script).not.toContain("file");
  });

  it("emits metrics in the shared ===SECTION=== format the hub parser expects", () => {
    const script = buildAgentPowerShell(HUB, TOKEN);
    for (const marker of ["===CPU===", "===MEM===", "===SWAP===", "===DISK===", "===LOAD===", "===NET==="]) {
      expect(script).toContain(marker);
    }
    // Disk mount point must be the LAST field (df --output row shape).
    expect(script).toContain("'{0}G {1}G {2} {3}' -f $total, $used, $pct, $_.DeviceID");
    // CPU usage is encoded as idle/total = (100-usage)/100.
    expect(script).toContain("' 100'");
  });

  it("installs into %ProgramData% and registers a resilient SYSTEM scheduled task", () => {
    const installer = buildWindowsAgentInstaller(HUB, TOKEN);
    expect(installer).toContain("Administrator");
    expect(installer).toContain("$agentDir = Join-Path $env:ProgramData 'VControlHub'");
    expect(installer).toContain(`$taskName = ${JSON.stringify(AGENT_WINDOWS_TASK_NAME)}`);
    expect(installer).toContain("Register-ScheduledTask");
    expect(installer).toContain("-User 'SYSTEM' -RunLevel Highest");
    expect(installer).toContain("-RestartCount 999");
    expect(installer).toContain("Start-ScheduledTask");
    // The agent payload is embedded as base64, not inline script text.
    const agentScript = buildAgentPowerShell(HUB, TOKEN);
    expect(installer).not.toContain(agentScript);
    const base64 = installer.match(/FromBase64String\("([^"]+)"\)/)?.[1];
    expect(base64).toBeTruthy();
    expect(Buffer.from(base64!, "base64").toString("utf8")).toBe(agentScript);
  });

  it("keeps the Windows cleanup command self-removing and detached", () => {
    // Detached delay (ping works with redirected stdin; timeout.exe does not),
    // then task stop/delete, then directory removal — mirroring the Linux
    // nohup self-removal ordering so the running agent survives to report.
    const detach = AGENT_WINDOWS_CLEANUP_COMMAND.indexOf("Start-Process");
    const delay = AGENT_WINDOWS_CLEANUP_COMMAND.indexOf("ping -n 4");
    const end = AGENT_WINDOWS_CLEANUP_COMMAND.indexOf("schtasks /end");
    const del = AGENT_WINDOWS_CLEANUP_COMMAND.indexOf("schtasks /delete");
    const rmdir = AGENT_WINDOWS_CLEANUP_COMMAND.indexOf("rd /s /q");
    expect(detach).toBeGreaterThanOrEqual(0);
    expect(delay).toBeGreaterThan(detach);
    expect(end).toBeGreaterThan(delay);
    expect(del).toBeGreaterThan(end);
    expect(rmdir).toBeGreaterThan(del);
    expect(AGENT_WINDOWS_CLEANUP_COMMAND).toContain(AGENT_WINDOWS_TASK_NAME);
  });
});

describe("prepareWindowsAgentInstall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverUpdate.mockResolvedValue({ id: "win" });
  });

  it("returns a one-liner that fetches the bootstrap script with the new token", async () => {
    // prepareWindowsAgentInstall reads the server, then issueServerAgentToken
    // re-reads it before issuing the token.
    mocks.serverFindUnique
      .mockResolvedValueOnce({ operatingSystem: "WINDOWS", managementMode: "AGENT" })
      .mockResolvedValueOnce({ id: "win" });
    const plan = await prepareWindowsAgentInstall("win");
    expect(plan.installCommand).toContain("https://hub.example.com/api/agent/v1/bootstrap");
    expect(plan.installCommand).toMatch(/Bearer vca_win_/);
    // Token stored as digest only.
    const stored = mocks.serverUpdate.mock.calls[0]?.[0]?.data.agentTokenHash as string;
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects Linux nodes and non-Agent mode before issuing a token", async () => {
    mocks.serverFindUnique.mockResolvedValueOnce({ operatingSystem: "LINUX", managementMode: "AGENT" });
    await expect(prepareWindowsAgentInstall("srv1")).rejects.toThrow(/Windows/);
    mocks.serverFindUnique.mockResolvedValueOnce({ operatingSystem: "WINDOWS", managementMode: "DIRECT" });
    await expect(prepareWindowsAgentInstall("win")).rejects.toThrow(/Agent/i);
    expect(mocks.serverUpdate).not.toHaveBeenCalled();
  });
});
