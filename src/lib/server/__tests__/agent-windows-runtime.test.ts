/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ serverFindUnique: vi.fn(), serverUpdate: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { server: { findUnique: mocks.serverFindUnique, update: mocks.serverUpdate } },
}));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));
vi.mock("@/lib/config/env", () => ({
  config: { app: { baseUrl: "https://hub.example.com" } },
}));

import { buildAgentPowerShell, buildWindowsAgentInstaller, prepareWindowsAgentInstall } from "../agent-service";
import { parseMonitorScriptOutput } from "../monitor";

const HUB = "https://hub.example.com";
const TOKEN = "vca_win_abcdefghijklmnopqrstuvwxyz0123456789";
const dir = process.platform === "win32" ? mkdtempSync(join(tmpdir(), "vch-agent-")) : "";

function powershell(args: string[]) {
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args], { encoding: "utf8", timeout: 60_000 });
}

/** PowerShell's own parser: any syntax error in what the hub generates. */
function parseErrors(name: string, script: string) {
  const file = join(dir, `${name}.ps1`);
  writeFileSync(file, script, "utf8");
  const check = `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$null, [ref]$errors); $errors | ForEach-Object { $_.Message }`;
  const result = powershell(["-Command", check]);
  return `${result.stdout}${result.stderr}`.trim();
}

// Only Windows has Windows PowerShell; CI's test-windows job runs these.
describe.skipIf(process.platform !== "win32")("Windows Agent scripts in Windows PowerShell", () => {
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("generates an agent, installer and install command that parse", async () => {
    mocks.serverFindUnique
      .mockResolvedValueOnce({ operatingSystem: "WINDOWS", managementMode: "AGENT" })
      .mockResolvedValueOnce({ id: "win" });
    mocks.serverUpdate.mockResolvedValue({ id: "win" });
    const { installCommand } = await prepareWindowsAgentInstall("win");
    expect(parseErrors("agent", buildAgentPowerShell(HUB, TOKEN))).toBe("");
    expect(parseErrors("installer", buildWindowsAgentInstaller(HUB, TOKEN))).toBe("");
    expect(parseErrors("install-command", installCommand)).toBe("");
  });

  it("collects metrics and host facts the hub parser reads", () => {
    const script = buildAgentPowerShell(HUB, TOKEN);
    // Everything before the poll loop: settings and functions, no network.
    const file = join(dir, "metrics.ps1");
    writeFileSync(file, `${script.slice(0, script.indexOf("$pending = $null"))}\nGet-AgentMetrics\n`, "utf8");
    const result = powershell(["-File", file]);
    expect(result.status, result.stderr).toBe(0);
    const metrics = parseMonitorScriptOutput(result.stdout);
    expect(metrics.cpu.cores).toBeGreaterThan(0);
    expect(metrics.memory.totalMb).toBeGreaterThan(0);
    expect(metrics.disk.length).toBeGreaterThan(0);
    expect(metrics.system?.os).toMatch(/Windows/);
    expect(metrics.system?.arch).toMatch(/^(x86_64|aarch64|i686)$/);
    expect(metrics.system?.processes).toBeGreaterThan(0);
  }, 60_000);

  it("reports a job when cmd ends, not when a process it left running does", () => {
    // The process holds the output pipes; reading to their end waited for it.
    const script = buildAgentPowerShell(HUB, TOKEN);
    const file = join(dir, "job.ps1");
    writeFileSync(file, [
      script.slice(0, script.indexOf("$pending = $null")),
      "$watch = [Diagnostics.Stopwatch]::StartNew()",
      "$result = Invoke-AgentJob ([pscustomobject]@{ id = 'bg'; command = 'start /b ping -n 25 127.0.0.1 & echo started'; timeoutMs = 60000 })",
      "[pscustomobject]@{ seconds = $watch.Elapsed.TotalSeconds; exitCode = $result.exitCode } | ConvertTo-Json -Compress",
    ].join("\n"), "utf8");
    const result = powershell(["-File", file]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!) as { seconds: number; exitCode: number };
    expect(report.exitCode).toBe(0);
    expect(report.seconds).toBeLessThan(20);
  }, 60_000);
});
