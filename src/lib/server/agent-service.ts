import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { shellQuote } from "@/lib/shell-quote";
import { buildSshParamsFromServer, execRemoteCommand } from "@/lib/ssh/client";
import { MONITOR_SCRIPT } from "./monitor";

const AGENT_VERSION = "1.1.0";
export const AGENT_FRESH_MS = 90_000;
export const AGENT_JOB_HEARTBEAT_MS = 30_000;
const AGENT_LEGACY_CLAIMED_STALE_MS = AGENT_FRESH_MS;
const AGENT_OUTPUT_LIMIT = 8 * 1_048_576;
/** Capabilities actually implemented by both the Linux (Python) and Windows (PowerShell) agents. */
const AGENT_CAPABILITIES = ["metrics", "command"] as const;
export const AGENT_WINDOWS_TASK_NAME = "VControlHubAgent";
export const AGENT_CLEANUP_COMMAND = "nohup sh -c 'sleep 2; systemctl disable vcontrolhub-agent.service >/dev/null 2>&1 || true; rm -f /etc/systemd/system/vcontrolhub-agent.service; rm -rf /opt/vcontrolhub-agent; systemctl daemon-reload >/dev/null 2>&1 || true; systemctl stop vcontrolhub-agent.service >/dev/null 2>&1 || true' >/dev/null 2>&1 &";
/**
 * Windows equivalent of AGENT_CLEANUP_COMMAND. Dispatched as an agent job and
 * executed through `cmd /c`, it detaches a hidden cmd that waits ~3s (ping
 * delay, timeout.exe rejects redirected stdin) before ending and deleting the
 * scheduled task and removing the agent directory — mirroring the Linux
 * "nohup sleep 2" self-removal pattern so the running agent is not killed
 * mid-job. %ProgramData% is expanded by the agent's cmd wrapper before
 * PowerShell parses the command; the path contains no spaces by construction.
 */
export const AGENT_WINDOWS_CLEANUP_COMMAND = `powershell -NoProfile -Command "Start-Process -WindowStyle Hidden cmd -ArgumentList '/c','ping -n 4 127.0.0.1 >nul & schtasks /end /tn ${AGENT_WINDOWS_TASK_NAME} >nul 2>&1 & schtasks /delete /f /tn ${AGENT_WINDOWS_TASK_NAME} >nul 2>&1 & rd /s /q %ProgramData%\\VControlHub >nul 2>&1'"`;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticateServerAgent(token: string) {
  const match = /^vca_([^_]+)_([A-Za-z0-9_-]{32,})$/.exec(token);
  if (!match) return null;
  const server = await prisma.server.findUnique({ where: { id: match[1] } });
  if (!server?.agentTokenHash || server.managementMode !== "AGENT") return null;
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(server.agentTokenHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? server : null;
}

export async function issueServerAgentToken(serverId: string) {
  const server = await prisma.server.findUnique({ where: { id: serverId }, select: { id: true } });
  if (!server) throw new Error("Server not found");
  const token = `vca_${serverId}_${randomBytes(32).toString("base64url")}`;
  await prisma.server.update({
    where: { id: serverId },
    data: { agentTokenHash: tokenHash(token), agentLastError: null },
  });
  return token;
}

export async function updateServerAgentHeartbeat(input: {
  serverId: string;
  version?: string;
  capabilities?: string[];
  metricsRaw?: string;
  error?: string | null;
}) {
  const now = new Date();
  await prisma.server.update({
    where: { id: input.serverId },
    data: {
      agentLastSeenAt: now,
      agentVersion: input.version?.slice(0, 64),
      agentCapabilities: (input.capabilities ?? [...AGENT_CAPABILITIES]).slice(0, 20),
      agentLastError: input.error?.slice(0, 1000) || null,
      ...(input.metricsRaw
        ? { agentMetricsRaw: input.metricsRaw.slice(0, 64_000), agentMetricsAt: now }
        : {}),
    },
  });
}

export async function completeServerAgentJob(input: {
  serverId: string;
  jobId: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  await prisma.serverAgentJob.updateMany({
    where: { id: input.jobId, serverId: input.serverId, status: "CLAIMED" },
    data: {
      status: input.exitCode === 0 ? "COMPLETED" : "FAILED",
      stdout: input.stdout?.slice(0, AGENT_OUTPUT_LIMIT) || null,
      stderr: input.stderr?.slice(0, AGENT_OUTPUT_LIMIT) || null,
      exitCode: Number.isInteger(input.exitCode) ? input.exitCode : 255,
      completedAt: new Date(),
      leaseExpiresAt: null,
    },
  });
}

export async function heartbeatServerAgentJob(input: {
  serverId: string;
  jobId: string;
}): Promise<boolean> {
  const leaseExpiresAt = new Date(Date.now() + AGENT_JOB_HEARTBEAT_MS);
  const updated = await prisma.serverAgentJob.updateMany({
    where: { id: input.jobId, serverId: input.serverId, status: "CLAIMED" },
    data: { leaseExpiresAt },
  });
  if (updated.count > 0) return false;
  const current = await prisma.serverAgentJob.findUnique({
    where: { id: input.jobId },
    select: { serverId: true, status: true },
  });
  return current?.serverId === input.serverId && current.status === "CANCELLED";
}

export async function claimNextServerAgentJob(serverId: string) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.serverAgentJob.updateMany({
      where: {
        serverId,
        status: "CLAIMED",
        OR: [
          { leaseExpiresAt: { lt: now } },
          {
            leaseExpiresAt: null,
            claimedAt: { lt: new Date(now.getTime() - AGENT_LEGACY_CLAIMED_STALE_MS) },
          },
        ],
      },
      data: {
        status: "CANCELLED",
        stderr: "Agent job lease expired before completion",
        exitCode: 124,
        completedAt: now,
        leaseExpiresAt: null,
      },
    });
    const next = await tx.serverAgentJob.findFirst({
      where: { serverId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return null;
    const claimed = await tx.serverAgentJob.updateMany({
      where: { id: next.id, status: "PENDING" },
      data: {
        status: "CLAIMED",
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + AGENT_JOB_HEARTBEAT_MS),
      },
    });
    return claimed.count === 1 ? next : null;
  });
}

export async function executeCommandWithAgent(input: {
  serverId: string;
  commandTargetId?: string;
  command: string;
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  const server = await prisma.server.findUnique({
    where: { id: input.serverId },
    select: { operatingSystem: true, managementMode: true, agentLastSeenAt: true },
  });
  if (
    server?.managementMode !== "AGENT" ||
    !server.agentLastSeenAt ||
    Date.now() - server.agentLastSeenAt.getTime() > AGENT_FRESH_MS
  ) return null;

  input.signal?.throwIfAborted();
  const job = await prisma.serverAgentJob.create({
    data: { serverId: input.serverId, commandTargetId: input.commandTargetId, command: input.command, timeoutMs: input.timeoutMs },
  });
  try {
  const deadline = Date.now() + input.timeoutMs + 10_000;
  while (Date.now() < deadline) {
    input.signal?.throwIfAborted();
    const current = await prisma.serverAgentJob.findUnique({ where: { id: job.id } });
    if (!current) return null;
    if (current.status === "COMPLETED" || current.status === "FAILED") {
      return { stdout: current.stdout ?? "", stderr: current.stderr ?? "", exitCode: current.exitCode ?? 255 };
    }
    if (current.status === "CANCELLED") return { stdout: "", stderr: "Agent job cancelled", exitCode: 130 };
    await delay(500, undefined, { signal: input.signal });
  }
  const current = await prisma.serverAgentJob.findUnique({ where: { id: job.id } });
  if (!current) return null;
  if (current.status === "COMPLETED" || current.status === "FAILED") {
    return { stdout: current.stdout ?? "", stderr: current.stderr ?? "", exitCode: current.exitCode ?? 255 };
  }
  if (current.status === "CANCELLED") {
    return { stdout: "", stderr: "Agent job cancelled", exitCode: 130 };
  }
  const cancelled = await prisma.serverAgentJob.updateMany({
    where: {
      id: job.id,
      serverId: input.serverId,
      status: { in: ["PENDING", "CLAIMED"] },
    },
    data: {
      status: "CANCELLED",
      stderr: "Agent command timed out after dispatch",
      exitCode: 124,
      completedAt: new Date(),
      leaseExpiresAt: null,
    },
  });
  if (cancelled.count === 0) {
    const final = await prisma.serverAgentJob.findUnique({ where: { id: job.id } });
    if (final?.status === "COMPLETED" || final?.status === "FAILED") {
      return { stdout: final.stdout ?? "", stderr: final.stderr ?? "", exitCode: final.exitCode ?? 255 };
    }
  }
  if (current.status === "PENDING") {
    return null;
  }
  return {
    stdout: current.stdout ?? "",
    stderr: "Agent command timed out after dispatch; SSH fallback was suppressed to avoid duplicate execution.",
    exitCode: 124,
  };
  } finally {
    if (input.signal?.aborted) {
      // A claimed command may have external side effects. Stop waiting without
      // pretending it was rolled back or replaying it through SSH.
      await prisma.serverAgentJob.updateMany({
        where: { id: job.id, serverId: input.serverId, status: "PENDING" },
        data: { status: "CANCELLED", stderr: "Caller cancelled before dispatch", exitCode: 130, completedAt: new Date() },
      });
    }
  }
}

function buildAgentPython(hubUrl: string, token: string) {
  const endpoint = new URL("/api/agent/v1/poll", hubUrl).toString();
  return `#!/usr/bin/env python3
import http.client, json, subprocess, time, urllib.parse
ENDPOINT=${JSON.stringify(endpoint)}
TOKEN=${JSON.stringify(token)}
MONITOR=${JSON.stringify(MONITOR_SCRIPT)}
VERSION=${JSON.stringify(AGENT_VERSION)}
HEARTBEAT_SECONDS=20
pending=None
last_metrics=0
parts=urllib.parse.urlsplit(ENDPOINT)
conn=None
def connect():
    cls=http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
    return cls(parts.hostname, parts.port, timeout=35)
def post(payload):
    global conn
    body=json.dumps(payload).encode()
    if conn is None: conn=connect()
    conn.request("POST", parts.path, body, {"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json","Content-Length":str(len(body))})
    response=conn.getresponse(); data=response.read()
    if response.status != 200: raise RuntimeError("hub returned %s" % response.status)
    return json.loads(data or b"{}")
def text(value):
    if value is None: return ""
    return value.decode(errors="replace") if isinstance(value, bytes) else value
def terminate(proc):
    if proc.poll() is None:
        proc.terminate()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill(); proc.wait()
while True:
    try:
        now=time.time()
        payload={"version":VERSION,"capabilities":${JSON.stringify([...AGENT_CAPABILITIES])}}
        if pending is not None: payload["result"]=pending
        if now-last_metrics >= 60:
            metrics=subprocess.run(["/bin/sh","-c",MONITOR],capture_output=True,text=True,timeout=15)
            payload["metricsRaw"]=metrics.stdout[:64000]; last_metrics=now
        message=post(payload)
        pending=None
        job=message.get("job")
        if job:
            timeout_seconds=max(1,min(int(job.get("timeoutMs",60000))/1000,3600))
            proc=subprocess.Popen(["/bin/sh","-c",job["command"]],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            deadline=time.time()+timeout_seconds
            while True:
                remaining=max(0,deadline-time.time())
                try:
                    stdout,stderr=proc.communicate(timeout=min(HEARTBEAT_SECONDS,remaining or 0.001))
                    pending={"jobId":job["id"],"stdout":text(stdout)[:8388608],"stderr":text(stderr)[:1048576],"exitCode":proc.returncode}
                    break
                except subprocess.TimeoutExpired as exc:
                    try:
                        heartbeat=post({"version":VERSION,"heartbeatJobId":job["id"]})
                    except Exception:
                        heartbeat={}
                    if heartbeat.get("cancelled"):
                        terminate(proc)
                        stdout,stderr=proc.communicate()
                        pending={"jobId":job["id"],"stdout":text(stdout or exc.stdout)[:8388608],"stderr":"Agent command cancelled"[:1048576],"exitCode":130}
                        break
                    if time.time() >= deadline:
                        terminate(proc)
                        stdout,stderr=proc.communicate()
                        pending={"jobId":job["id"],"stdout":text(stdout or exc.stdout)[:8388608],"stderr":"Agent command timed out"[:1048576],"exitCode":124}
                        break
        else: time.sleep(max(1,min(int(message.get("pollAfterMs",5000))/1000,30)))
    except Exception:
        try:
            if conn: conn.close()
        except Exception: pass
        conn=None; time.sleep(5)
`;

}

/**
 * PowerShell 5.1 agent for Windows nodes (Windows 10 / Server 2016+). It speaks
 * the exact same poll protocol as the Linux Python agent: polls
 * /api/agent/v1/poll with a Bearer token, executes jobs through
 * `cmd /c` (with `chcp 65001` so UTF-8 output round-trips), heartbeats long
 * jobs every ~20s, and reports metrics in the shared ===SECTION=== format the
 * hub-side monitor parser already understands (see src/lib/server/monitor.ts).
 */
export function buildAgentPowerShell(hubUrl: string, token: string) {
  const endpoint = new URL("/api/agent/v1/poll", hubUrl).toString();
  return [
    "# VControlHub Windows Agent",
    "$ErrorActionPreference = 'Continue'",
    "Add-Type -AssemblyName System.Net.Http | Out-Null",
    `$ENDPOINT = ${JSON.stringify(endpoint)}`,
    `$TOKEN = ${JSON.stringify(token)}`,
    `$VERSION = ${JSON.stringify(AGENT_VERSION)}`,
    "$HEARTBEAT_SECONDS = 20",
    "$OUTPUT_LIMIT = 8388608",
    "$ERROR_LIMIT = 1048576",
    "",
    "$script:Client = New-Object System.Net.Http.HttpClient",
    "$script:Client.Timeout = [TimeSpan]::FromSeconds(35)",
    "",
    "function Invoke-AgentPost {",
    "  param([string]$Json)",
    "  $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $ENDPOINT)",
    "  $null = $request.Headers.TryAddWithoutValidation('Authorization', 'Bearer ' + $TOKEN)",
    "  $request.Content = New-Object System.Net.Http.StringContent($Json, [System.Text.Encoding]::UTF8, 'application/json')",
    "  $response = $script:Client.SendAsync($request).GetAwaiter().GetResult()",
    "  try {",
    "    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()",
    "    if (-not $response.IsSuccessStatusCode) { throw ('hub returned ' + [int]$response.StatusCode) }",
    "    if ([string]::IsNullOrWhiteSpace($body)) { return $null }",
    "    return ($body | ConvertFrom-Json)",
    "  } finally {",
    "    $request.Dispose()",
    "    $response.Dispose()",
    "  }",
    "}",
    "",
    "function Get-AgentMetrics {",
    "  $lines = New-Object System.Collections.Generic.List[string]",
    "  $osInfo = Get-CimInstance Win32_OperatingSystem",
    "  $cpuTotal = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\" -ErrorAction SilentlyContinue | Select-Object -First 1",
    "  $usage = 0.0",
    "  if ($cpuTotal -and $null -ne $cpuTotal.PercentProcessorTime) { $usage = [double]$cpuTotal.PercentProcessorTime }",
    "  if ($usage -lt 0) { $usage = 0 }",
    "  if ($usage -gt 100) { $usage = 100 }",
    "  $lines.Add('===CPU===')",
    "  $lines.Add([string][Environment]::ProcessorCount)",
    "  $lines.Add('0 0 0')",
    "  # Hub parser derives usage from idle/total ticks; emit 100-usage of 100.",
    "  $lines.Add(([string][Math]::Round(100 - $usage, 1)) + ' 100')",
    "  $lines.Add('===MEM===')",
    "  $totalMb = [int][Math]::Round($osInfo.TotalVisibleMemorySize / 1024)",
    "  $freeMb = [int][Math]::Round($osInfo.FreePhysicalMemory / 1024)",
    "  $lines.Add(($totalMb.ToString() + ' ' + ($totalMb - $freeMb).ToString() + ' ' + $freeMb.ToString()))",
    "  $lines.Add('===SWAP===')",
    "  $lines.Add('0 0')",
    "  $lines.Add('===DISK===')",
    "  Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction SilentlyContinue | ForEach-Object {",
    "    if ($_.Size -gt 0) {",
    "      $total = [Math]::Round($_.Size / 1GB, 1)",
    "      $used = [Math]::Round(($_.Size - $_.FreeSpace) / 1GB, 1)",
    "      $pct = [int][Math]::Round(100 * ($_.Size - $_.FreeSpace) / $_.Size)",
    "      # Mount point is the LAST field — same shape as `df -h --output` rows.",
    "      $lines.Add(('{0}G {1}G {2} {3}' -f $total, $used, $pct, $_.DeviceID))",
    "    }",
    "  }",
    "  $lines.Add('===LOAD===')",
    "  $up = (Get-Date) - $osInfo.LastBootUpTime",
    "  $lines.Add(('up {0} days, {1}:{2}' -f [int][Math]::Floor($up.TotalDays), $up.Hours, $up.Minutes.ToString('00')))",
    "  $lines.Add('===NET===')",
    "  Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object {",
    "    $lines.Add(('{0} {1} {2}' -f $_.Name, [long]$_.ReceivedBytes, [long]$_.SentBytes))",
    "  }",
    "  return ($lines -join [string][char]10)",
    "}",
    "",
    "function Invoke-AgentJob {",
    "  param($Job)",
    "  $timeoutSeconds = [int][Math]::Max(1, [Math]::Min([int]([double]$Job.timeoutMs / 1000), 3600))",
    "  $startInfo = New-Object System.Diagnostics.ProcessStartInfo",
    "  $startInfo.FileName = $env:ComSpec",
    "  $startInfo.Arguments = '/c chcp 65001 >nul & ' + [string]$Job.command",
    "  $startInfo.UseShellExecute = $false",
    "  $startInfo.RedirectStandardOutput = $true",
    "  $startInfo.RedirectStandardError = $true",
    "  $startInfo.CreateNoWindow = $true",
    "  $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8",
    "  $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8",
    "  $process = [System.Diagnostics.Process]::Start($startInfo)",
    "  $stdoutTask = $process.StandardOutput.ReadToEndAsync()",
    "  $stderrTask = $process.StandardError.ReadToEndAsync()",
    "  $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)",
    "  $lastHeartbeat = [DateTime]::UtcNow",
    "  $cancelled = $false",
    "  while (-not $process.HasExited) {",
    "    if ([DateTime]::UtcNow -ge $deadline) { break }",
    "    if (([DateTime]::UtcNow - $lastHeartbeat).TotalSeconds -ge $HEARTBEAT_SECONDS) {",
    "      try {",
    "        $beat = Invoke-AgentPost ((@{ version = $VERSION; heartbeatJobId = [string]$Job.id } | ConvertTo-Json -Compress))",
    "        if ($beat -and $beat.cancelled) { $cancelled = $true; break }",
    "      } catch { }",
    "      $lastHeartbeat = [DateTime]::UtcNow",
    "    }",
    "    Start-Sleep -Milliseconds 500",
    "  }",
    "  $timedOut = $false",
    "  if (-not $process.HasExited) {",
    "    $timedOut = -not $cancelled",
    "    $null = & $env:ComSpec /c ('taskkill /PID ' + $process.Id + ' /T /F >nul 2>&1')",
    "    try { $process.Kill() } catch { }",
    "    try { $process.WaitForExit(5000) | Out-Null } catch { }",
    "  }",
    "  $stdout = ''",
    "  $stderr = ''",
    "  try { $stdout = $stdoutTask.Result } catch { }",
    "  try { $stderr = $stderrTask.Result } catch { }",
    "  if ($stdout.Length -gt $OUTPUT_LIMIT) { $stdout = $stdout.Substring(0, $OUTPUT_LIMIT) }",
    "  if ($stderr.Length -gt $ERROR_LIMIT) { $stderr = $stderr.Substring(0, $ERROR_LIMIT) }",
    "  # Hub protocol caps exitCode at 255; Windows exit codes are 32-bit.",
    "  $exitCode = $process.ExitCode",
    "  if ($cancelled) { $exitCode = 130; $stderr = 'Agent command cancelled' }",
    "  elseif ($timedOut) { $exitCode = 124; $stderr = 'Agent command timed out' }",
    "  elseif ($exitCode -lt 0 -or $exitCode -gt 255) { $exitCode = 1 }",
    "  return [ordered]@{ jobId = [string]$Job.id; stdout = $stdout; stderr = $stderr; exitCode = $exitCode }",
    "}",
    "",
    "$pending = $null",
    "$lastMetrics = [DateTime]::MinValue",
    "while ($true) {",
    "  $sleepMilliseconds = 5000",
    "  try {",
    `    $payload = [ordered]@{ version = $VERSION; capabilities = @(${[...AGENT_CAPABILITIES].map((c) => `'${c}'`).join(", ")}) }`,
    "    if ($null -ne $pending) { $payload['result'] = $pending }",
    "    $now = [DateTime]::UtcNow",
    "    if (($now - $lastMetrics).TotalSeconds -ge 60) {",
    "      try {",
    "        $raw = Get-AgentMetrics",
    "        if ($raw) { $payload['metricsRaw'] = $raw.Substring(0, [Math]::Min(64000, $raw.Length)) }",
    "      } catch { }",
    "      $lastMetrics = $now",
    "    }",
    "    $message = Invoke-AgentPost ($payload | ConvertTo-Json -Depth 6 -Compress)",
    "    $pending = $null",
    "    if ($message -and $message.job) {",
    "      $pending = Invoke-AgentJob $message.job",
    "      $sleepMilliseconds = 1000",
    "    } elseif ($message -and $message.pollAfterMs) {",
    "      try { $sleepMilliseconds = [Math]::Max(1000, [Math]::Min([int]$message.pollAfterMs, 30000)) } catch { }",
    "    }",
    "  } catch {",
    "    $sleepMilliseconds = 5000",
    "  }",
    "  Start-Sleep -Milliseconds $sleepMilliseconds",
    "}",
  ].join("\n");
}

/**
 * Installer script served by GET /api/agent/v1/bootstrap. The user runs the
 * one-liner from prepareWindowsAgentInstall in an elevated PowerShell on the
 * Windows machine; it writes the agent (with embedded token) to
 * %ProgramData%\VControlHub\agent.ps1, registers a SYSTEM scheduled task that
 * starts at boot and restarts on failure, and starts it immediately.
 */
export function buildWindowsAgentInstaller(hubUrl: string, token: string) {
  const agentBase64 = Buffer.from(buildAgentPowerShell(hubUrl, token), "utf8").toString("base64");
  return [
    "# VControlHub Windows agent installer - run in an elevated PowerShell.",
    "$ErrorActionPreference = 'Stop'",
    "$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())",
    "if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {",
    "  Write-Error 'VControlHub agent setup requires an elevated (Administrator) PowerShell.'",
    "  exit 1",
    "}",
    "$agentDir = Join-Path $env:ProgramData 'VControlHub'",
    "New-Item -ItemType Directory -Path $agentDir -Force | Out-Null",
    "$agentPath = Join-Path $agentDir 'agent.ps1'",
    `[System.IO.File]::WriteAllBytes($agentPath, [Convert]::FromBase64String(${JSON.stringify(agentBase64)}))`,
    `$taskName = ${JSON.stringify(AGENT_WINDOWS_TASK_NAME)}`,
    "$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $agentPath + '\"')",
    "$trigger = New-ScheduledTaskTrigger -AtStartup",
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 365) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)",
    "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null",
    "Start-ScheduledTask -TaskName $taskName",
    "Write-Output 'VControlHub agent installed and started.'",
  ].join("\n");
}

export async function installServerAgent(serverId: string) {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: { sshKey: { select: { privateKey: true, passphrase: true } } },
  });
  if (!server) throw new Error("Server not found");
  // Windows nodes have no SSH channel; the agent is installed manually through
  // prepareWindowsAgentInstall + the bootstrap endpoint instead.
  if (server.operatingSystem === "WINDOWS") throw new BusinessError(t("backend.server.agentManualInstall"));
  const hubUrl = config.app.baseUrl;
  if (!hubUrl) throw new Error("APP_BASE_URL is required to install Agent mode");
  const parsed = new URL(hubUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("Agent hub URL must use HTTPS");
  }
  const token = await issueServerAgentToken(serverId);
  const python = Buffer.from(buildAgentPython(hubUrl, token)).toString("base64");
  const unit = `[Unit]\nDescription=VControlHub Agent\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=/usr/bin/python3 /opt/vcontrolhub-agent/agent.py\nRestart=always\nRestartSec=5\nNoNewPrivileges=true\n\n[Install]\nWantedBy=multi-user.target\n`;
  const command = `command -v python3 >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1 && install -d -m 700 /opt/vcontrolhub-agent && printf %s ${shellQuote(python)} | base64 -d > /opt/vcontrolhub-agent/agent.py && chmod 700 /opt/vcontrolhub-agent/agent.py && printf %s ${shellQuote(unit)} > /etc/systemd/system/vcontrolhub-agent.service && systemctl daemon-reload && systemctl enable --now vcontrolhub-agent.service`;
  const ssh = await buildSshParamsFromServer(server, server.sshKey);
  const result = await execRemoteCommand({ ...ssh, command, timeout: 60_000 });
  if (result.exitCode !== 0) {
    await prisma.server.update({ where: { id: serverId }, data: { agentLastError: (result.stderr || result.stdout || "Agent installation failed").slice(0, 1000) } });
    throw new Error(result.stderr || result.stdout || "Agent installation failed");
  }
  return { installed: true };
}

/**
 * Windows nodes cannot be pushed an agent over SSH (they only have an RDP
 * channel). Instead we issue a token and hand the operator a single
 * PowerShell one-liner that downloads the installer from the authenticated
 * bootstrap endpoint and runs it on the Windows machine.
 */
export async function prepareWindowsAgentInstall(serverId: string) {
  const hubUrl = config.app.baseUrl;
  if (!hubUrl) throw new Error("APP_BASE_URL is required to install Agent mode");
  const parsed = new URL(hubUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("Agent hub URL must use HTTPS");
  }
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { operatingSystem: true, managementMode: true },
  });
  if (!server) throw new Error("Server not found");
  if (server.operatingSystem !== "WINDOWS") throw new BusinessError(t("backend.server.agentManualInstall"));
  if (server.managementMode !== "AGENT") throw new BusinessError(t("backend.server.agentModeRequired"));
  const token = await issueServerAgentToken(serverId);
  const bootstrapUrl = new URL("/api/agent/v1/bootstrap", hubUrl).toString();
  const installCommand = `& ([scriptblock]::Create((Invoke-RestMethod -UseBasicParsing -Uri '${bootstrapUrl}' -Headers @{ Authorization = 'Bearer ${token}' })))`;
  return { installCommand, bootstrapUrl };
}

export async function uninstallServerAgent(serverId: string) {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: { sshKey: { select: { privateKey: true, passphrase: true } } },
  });
  if (!server) return { removed: false };
  if (server.operatingSystem === "WINDOWS") {
    // No SSH fallback exists for Windows nodes: dispatch the self-removal
    // command through the agent itself, then always revoke the token.
    let removed = false;
    if (server.agentLastSeenAt && Date.now() - server.agentLastSeenAt.getTime() < AGENT_FRESH_MS) {
      const result = await executeCommandWithAgent({
        serverId,
        command: AGENT_WINDOWS_CLEANUP_COMMAND,
        timeoutMs: 15_000,
      }).catch(() => null);
      removed = result?.exitCode === 0;
    }
    await prisma.server.update({ where: { id: serverId }, data: { agentTokenHash: null } });
    return { removed };
  }
  const cleanupCommand = AGENT_CLEANUP_COMMAND;
  let removed = false;
  if (server.agentLastSeenAt && Date.now() - server.agentLastSeenAt.getTime() < AGENT_FRESH_MS) {
    const result = await executeCommandWithAgent({
      serverId,
      command: cleanupCommand,
      timeoutMs: 15_000,
    }).catch(() => null);
    removed = result?.exitCode === 0;
  }
  try {
    if (!removed) {
      const hasSshCredential = server.connectionType === "SSH_KEY"
        ? Boolean(server.sshKeyId && server.sshKey?.privateKey)
        : Boolean(server.password);
      if (hasSshCredential) {
        const ssh = await buildSshParamsFromServer(server, server.sshKey);
        await execRemoteCommand({ ...ssh, command: cleanupCommand, timeout: 30_000 });
        removed = true;
      }
    }
  } catch {
    removed = false;
  } finally {
    await prisma.server.update({ where: { id: serverId }, data: { agentTokenHash: null } });
  }
  return { removed };
}
