/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ serverFindUnique: vi.fn(), serverUpdate: vi.fn() }));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: async () => async () => {} }));
vi.mock("@/lib/db", () => ({
  prisma: { server: { findUnique: mocks.serverFindUnique, update: mocks.serverUpdate } },
}));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));
vi.mock("@/lib/config/env", () => ({
  config: { app: { baseUrl: "https://hub.example.com" } },
}));

import { buildAgentPowerShell, buildWindowsAgentInstaller, prepareWindowsAgentInstall } from "../agent-service";
import { windowsAgentSelfRemoval } from "../agent-lifecycle-scripts";
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
      .mockResolvedValueOnce({ operatingSystem: "WINDOWS", managementMode: "AGENT" });
    mocks.serverUpdate.mockResolvedValue({ id: "win" });
    const { installCommand } = await prepareWindowsAgentInstall("win");
    expect(parseErrors("agent", buildAgentPowerShell(HUB, TOKEN))).toBe("");
    expect(parseErrors("installer", buildWindowsAgentInstaller(HUB, TOKEN))).toBe("");
    expect(parseErrors("install-command", installCommand)).toBe("");
  });

  it("removes old explicit grants and verifies both ACLs before installing the script", () => {
    const installer = buildWindowsAgentInstaller(HUB, TOKEN);
    const protect = installer.slice(installer.indexOf("function Protect-AgentPath"), installer.indexOf("Protect-AgentPath $agentDir $true"));
    const file = join(dir, "permissions.ps1");
    writeFileSync(file, [
      "$ErrorActionPreference = 'Stop'",
      protect,
      "$agentDir = Join-Path $PSScriptRoot 'acl-fixture'",
      "New-Item -Type Directory -Path $agentDir | Out-Null",
      "& icacls.exe $agentDir /grant '*S-1-5-32-545:(OI)(CI)R' | Out-Null",
      "if ($LASTEXITCODE -ne 0) { throw 'fixture ACL failed' }",
      "Protect-AgentPath $agentDir $true",
      "$agentPath = Join-Path $agentDir 'agent.ps1'",
      "[IO.File]::Open($agentPath, [IO.FileMode]::CreateNew).Dispose()",
      "Protect-AgentPath $agentPath $false",
      "foreach ($path in @($agentDir, $agentPath)) {",
      "  $acl = if ($path -eq $agentDir) { [IO.Directory]::GetAccessControl($path) } else { [IO.File]::GetAccessControl($path) }",
      "  $sids = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object",
      "  if (!$acl.AreAccessRulesProtected -or ($sids -join ',') -ne 'S-1-5-18,S-1-5-32-544') { throw 'Unexpected permissions' }",
      "}",
    ].join("\n"), "utf8");
    const result = powershell(["-File", file]);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([401, 403])("stops a long job on HTTP %i", status => {
    const script = buildAgentPowerShell(HUB, TOKEN);
    const file = join(dir, `revoke-${status}.ps1`);
    writeFileSync(file, [
      script.slice(0, script.search(/^while \(\$true\) \{/m)),
      "$HEARTBEAT_SECONDS = 0",
      "$script:lastMetrics = [DateTime]::UtcNow",
      `function Invoke-AgentPost { $script:LastStatus = ${status}; throw 'denied' }`,
      "$watch = [Diagnostics.Stopwatch]::StartNew()",
      "try { Invoke-AgentJob ([pscustomobject]@{ id = 'running'; command = 'ping -n 30 127.0.0.1'; timeoutMs = 60000 }); exit 1 }",
      "catch { if ($_.Exception.Message -ne 'Agent authorization revoked' -or $watch.Elapsed.TotalSeconds -gt 15) { exit 1 } }",
    ].join("\n"), "utf8");
    const result = powershell(["-File", file]);
    expect(result.status, result.stderr).toBe(0);
  }, 30_000);

  it("restores the terminal receipt in a fresh PowerShell process", () => {
    const script = buildAgentPowerShell(HUB, TOKEN);
    const main = script.search(/^while \(\$true\) \{/m);
    expect(main).toBeGreaterThan(0);
    const file = join(dir, "receipt.ps1");
    const run = (lines: string[]) => {
      writeFileSync(file, [script.slice(0, main), ...lines].join("\n"), "utf8");
      const result = powershell(["-File", file]);
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    run(["Save-Receipt @{ jobId = 'fixture'; stdout = 'done'; stderr = ''; exitCode = 0 }"]);
    expect(JSON.parse(run(["$pending | ConvertTo-Json -Compress", "[IO.File]::Delete($receiptPath)"])))
      .toMatchObject({ jobId: "fixture", stdout: "done", exitCode: 0 });
    expect(run(["if ($pending) { exit 1 }"])).toBe("");
  });

  it("leaves a replacement installation and its task alone during deferred removal", () => {
    const command = windowsAgentSelfRemoval("VControlHubAgent", "previous");
    const script = Buffer.from(command.match(/'-EncodedCommand','([A-Za-z0-9+/=]+)'/)![1]!, "base64").toString("utf16le");
    const file = join(dir, "stale-cleanup.ps1");
    writeFileSync(file, [
      "$ErrorActionPreference = 'Stop'",
      "$env:ProgramData = $PSScriptRoot",
      "New-Item -Type Directory -Path (Join-Path $PSScriptRoot 'VControlHub') -Force | Out-Null",
      "$stamp = Join-Path $PSScriptRoot 'VControlHub/install-id'",
      "Set-Content -LiteralPath $stamp -Value 'replacement'",
      "function Stop-ScheduledTask { throw 'old cleanup reached the replacement task' }",
      "function Unregister-ScheduledTask { throw 'old cleanup reached the replacement task' }",
      "& {", script, "}",
      "if ((Get-Content -LiteralPath $stamp -Raw).Trim() -ne 'replacement') { exit 1 }",
    ].join("\n"), "utf8");
    const result = powershell(["-File", file]);
    expect(result.status, result.stderr).toBe(0);
  }, 30_000);

  it("collects metrics and host facts the hub parser reads", () => {
    const script = buildAgentPowerShell(HUB, TOKEN);
    // Everything before the poll loop: settings and functions, no network.
    const file = join(dir, "metrics.ps1");
    writeFileSync(file, `${script.slice(0, script.search(/^while \(\$true\) \{/m))}\nGet-AgentMetrics\n`, "utf8");
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
      script.slice(0, script.search(/^while \(\$true\) \{/m)),
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
