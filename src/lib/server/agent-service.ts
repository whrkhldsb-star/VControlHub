import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { shellQuote } from "@/lib/shell-quote";
import { buildSshParamsFromServer, execRemoteCommand } from "@/lib/ssh/client";
import { MONITOR_SCRIPT, isUsableMonitorOutput, parseMonitorScriptOutput } from "./monitor";
import { normalizeServerMetrics } from "@/lib/public-status/normalize";
import { writeLatestMetrics } from "@/lib/public-status/latest-writer";
import { createLogger } from "@/lib/logging";
import { CommandCancellationUnconfirmedError } from "@/lib/command/cancellation-error";
import { AGENT_VERSION } from "./agent-version";

export const AGENT_FRESH_MS = 90_000;
export const AGENT_JOB_HEARTBEAT_MS = 30_000;
/** Both Agent scripts send a metric report at most once per this many seconds. */
export const AGENT_METRICS_INTERVAL_SECONDS = 60;
const logger = createLogger("server-agent");
const AGENT_LEGACY_CLAIMED_STALE_MS = AGENT_FRESH_MS;
const AGENT_OUTPUT_LIMIT = 8 * 1_048_576;
/** Capabilities actually implemented by both the Linux (Python) and Windows (PowerShell) agents. */
const AGENT_CAPABILITIES = ["metrics", "command"] as const;
/** The Linux Agent also installs the hub's build itself (see agentSelfUpdateFor). */
const LINUX_AGENT_CAPABILITIES = [...AGENT_CAPABILITIES, "self-update"] as const;
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

/**
 * Removal over SSH, for when the Agent cannot remove itself: synchronous (the
 * Agent is not the one running it), so the exit code says whether it worked.
 */
export const AGENT_SSH_CLEANUP_SCRIPT = "systemctl disable --now vcontrolhub-agent.service >/dev/null 2>&1 || true; rm -f /etc/systemd/system/vcontrolhub-agent.service; rm -rf /opt/vcontrolhub-agent; systemctl daemon-reload >/dev/null 2>&1 || true";

/**
 * .NET before 4.7 (Windows Server 2016) offers only TLS 1.0/1.1 by default,
 * which the hub's edge refuses. Adds TLS 1.2 there; SystemDefault (0) on newer
 * systems is left alone so they keep TLS 1.3.
 */
const POWERSHELL_ENABLE_TLS12 = "$tlsProtocols = [int][Net.ServicePointManager]::SecurityProtocol; if ($tlsProtocols -ne 0) { [Net.ServicePointManager]::SecurityProtocol = $tlsProtocols -bor 3072 }";

/** `script` as root: directly for a root login, else through passwordless sudo (cloud images log in as ubuntu, opc, ec2-user…). */
function asRoot(script: string) {
  const quoted = shellQuote(script);
  return `if [ "$(id -u)" -eq 0 ]; then sh -c ${quoted}; elif command -v sudo >/dev/null 2>&1; then sudo -n sh -c ${quoted}; else echo "The Agent needs a root login or passwordless sudo" >&2; exit 1; fi`;
}

/** Abortable sleep on the global timer (so it follows fake timers in tests). */
function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

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
  // A Windows node is created "needs attention" until its Agent is in place
  // (there is no SSH check to run). Its first heartbeat is that proof; the
  // node stayed unselectable as a command target without it.
  await prisma.server.updateMany({
    where: { id: input.serverId, operatingSystem: "WINDOWS", managementMode: "AGENT", onboardingStatus: "NEEDS_ATTENTION" },
    data: { onboardingStatus: "READY", onboardingLastError: null },
  });
  if (input.metricsRaw) await recordAgentLatestMetrics(input.serverId, input.metricsRaw.slice(0, 64_000), now);
}

/**
 * Normalised copy of an Agent report for the status board. An unusable
 * report is recorded as a collection failure, not as zeros; a failed write
 * only logs, the heartbeat itself has already been stored.
 */
async function recordAgentLatestMetrics(serverId: string, raw: string, at: Date) {
  try {
    const metrics = parseMonitorScriptOutput(raw);
    const usable = isUsableMonitorOutput(raw, metrics);
    await writeLatestMetrics([
      usable
        ? {
            serverId,
            checkedAt: at,
            online: true,
            intervalSeconds: AGENT_METRICS_INTERVAL_SECONDS,
            metrics: { sampledAt: at, source: "agent", values: normalizeServerMetrics(metrics) },
          }
        : { serverId, checkedAt: at, online: false, offlineReason: "collect_failed", intervalSeconds: AGENT_METRICS_INTERVAL_SECONDS },
    ]);
  } catch (error) {
    logger.warn("agent latest metric upsert failed", { serverId, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function completeServerAgentJob(input: {
  serverId: string;
  jobId: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  const resultData = {
    stdout: input.stdout?.slice(0, AGENT_OUTPUT_LIMIT) || null,
    stderr: input.stderr?.slice(0, AGENT_OUTPUT_LIMIT) || null,
    exitCode: Number.isInteger(input.exitCode) ? input.exitCode : 255,
    completedAt: new Date(),
    leaseExpiresAt: null,
  };
  await prisma.serverAgentJob.updateMany({
    where: { id: input.jobId, serverId: input.serverId, status: "CLAIMED" },
    data: {
      status: input.exitCode === 0 ? "COMPLETED" : "FAILED",
      ...resultData,
    },
  });
  // CANCELLED + no completedAt is a request, not remote acknowledgement.
  await prisma.serverAgentJob.updateMany({
    where: { id: input.jobId, serverId: input.serverId, status: "CANCELLED", completedAt: null },
    data: { status: input.exitCode === 130 ? "CANCELLED" : input.exitCode === 0 ? "COMPLETED" : "FAILED", ...resultData },
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
      // An expired lease means the control plane lost contact, not that the
      // remote process stopped (an Agent blocked on a slow request keeps
      // running its command). Record a cancellation REQUEST — no completedAt —
      // so a live Agent stops the process and acknowledges via its next
      // heartbeat, and nobody reads this as a finished job and runs it again.
      data: {
        status: "CANCELLED",
        stderr: "Agent job lease expired; awaiting Agent cancellation acknowledgement",
        exitCode: 124,
        completedAt: null,
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
  const cancelledBeforeDispatch = () => ({ stdout: "", stderr: "Cancelled before Agent dispatch", exitCode: 130, cancelled: true });
  if (input.signal?.aborted) return cancelledBeforeDispatch();
  const server = await prisma.server.findUnique({
    where: { id: input.serverId },
    select: { operatingSystem: true, managementMode: true, agentLastSeenAt: true },
  });
  if (
    server?.managementMode !== "AGENT" ||
    !server.agentLastSeenAt ||
    Date.now() - server.agentLastSeenAt.getTime() > AGENT_FRESH_MS
  ) return null;

  if (input.signal?.aborted) return cancelledBeforeDispatch();
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
    if (current.status === "CANCELLED" && current.completedAt) return { stdout: "", stderr: current.stderr ?? "Agent job cancelled", exitCode: current.exitCode ?? 130, cancelled: current.exitCode === 130 };
    await delay(500, input.signal);
  }
  // Deadline passed. Only a job that provably never left PENDING may fall
  // back to SSH; the PENDING check and the cancel are one atomic update, so an
  // Agent that claims it at this moment makes the update miss instead of the
  // command running twice (once by the Agent, once over SSH).
  const neverDispatched = await prisma.serverAgentJob.updateMany({
    where: { id: job.id, serverId: input.serverId, status: "PENDING" },
    data: { status: "CANCELLED", stderr: "Agent did not pick the job up in time", exitCode: 124, completedAt: new Date(), leaseExpiresAt: null },
  });
  if (neverDispatched.count > 0) return null;
  return awaitAgentCancellation(job.id, input.serverId, "Agent command timed out after dispatch; awaiting cancellation acknowledgement");
  } catch (error) {
    if (!input.signal?.aborted) throw error;
    try {
    const pending = await withAgentCancellationDeadline(prisma.serverAgentJob.updateMany({
      where: { id: job.id, serverId: input.serverId, status: "PENDING" },
      data: { status: "CANCELLED", stderr: "Cancelled before Agent dispatch", exitCode: 130, completedAt: new Date(), leaseExpiresAt: null },
    }));
    if (pending.count > 0) return { stdout: "", stderr: "Cancelled before Agent dispatch", exitCode: 130, cancelled: true };
    } catch { /* Any control-plane failure leaves cancellation unconfirmed. */ }
    return awaitAgentCancellation(job.id, input.serverId, "Awaiting remote Agent cancellation acknowledgement");
  }
}

/** Agents heartbeat every 20 seconds and allow five seconds for shutdown. */
const AGENT_CANCEL_ACK_MS = 35_000;

/**
 * Ask the Agent to stop a dispatched job and wait for its own report. A job
 * already finished by the Agent returns its real result. Without a report the
 * remote outcome is unknown: CommandCancellationUnconfirmedError — never a
 * synthetic failure that would invite a retry or an SSH fallback.
 */
async function awaitAgentCancellation(jobId: string, serverId: string, reason: string) {
  try {
    await withAgentCancellationDeadline(prisma.serverAgentJob.updateMany({
      where: { id: jobId, serverId, status: "CLAIMED" },
      data: { status: "CANCELLED", stderr: reason, exitCode: 130, completedAt: null, leaseExpiresAt: null },
    }));
    const acknowledgementDeadline = Date.now() + AGENT_CANCEL_ACK_MS;
    for (;;) {
      const current = await withAgentCancellationDeadline(prisma.serverAgentJob.findUnique({ where: { id: jobId } }));
      if (!current) break;
      if (current.completedAt && ["COMPLETED", "FAILED", "CANCELLED"].includes(current.status)) {
        return { stdout: current.stdout ?? "", stderr: current.stderr ?? "", exitCode: current.exitCode ?? 255, cancelled: current.status === "CANCELLED" && current.exitCode === 130 };
      }
      if (Date.now() >= acknowledgementDeadline) break;
      await delay(500);
    }
  } catch { /* Any control-plane failure leaves cancellation unconfirmed. */ }
  throw new CommandCancellationUnconfirmedError();
}

async function withAgentCancellationDeadline<T>(query: PromiseLike<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([query, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Agent cancellation lookup deadline exceeded")), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

export function buildAgentPython(hubUrl: string, token: string) {
  const endpoint = new URL("/api/agent/v1/poll", hubUrl).toString();
  return `#!/usr/bin/env python3
import base64, http.client, json, os, signal, subprocess, sys, threading, time, urllib.parse
ENDPOINT=${JSON.stringify(endpoint)}
TOKEN=${JSON.stringify(token)}
MONITOR=${JSON.stringify(MONITOR_SCRIPT)}
VERSION=${JSON.stringify(AGENT_VERSION)}
CAPABILITIES=${JSON.stringify([...LINUX_AGENT_CAPABILITIES])}
HEARTBEAT_SECONDS=20
OUTPUT_LIMIT=8388608
ERROR_LIMIT=1048576
# After the shell ends, how long a process it left in the background may keep
# the output pipes before the job is reported without waiting for it.
OUTPUT_GRACE_SECONDS=10
UPDATE_RETRY_SECONDS=600
REJECTED="Agent result rejected by the hub"
# Split so that the only line holding the joined text is a template's TOKEN line.
PLACEHOLDER="__VCH_"+"AGENT_TOKEN__"
SCRIPT=os.path.realpath(sys.argv[0])
pending=None
last_metrics=None
metrics_error=None
update_error=None
update_failed={}
stopping=False
parts=urllib.parse.urlsplit(ENDPOINT)
conn=None
class HubStatus(Exception):
    def __init__(self, status):
        Exception.__init__(self, "hub returned %s" % status)
        self.status=status
class AgentStop(BaseException):
    pass
def on_stop(signum, frame):
    # systemd stops or restarts the service: stop the job, report it, leave.
    global stopping
    if stopping: return
    stopping=True
    raise AgentStop()
def connect(timeout=35):
    cls=http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
    return cls(parts.hostname, parts.port, timeout=timeout)
def text(value):
    if value is None: return ""
    return value.decode(errors="replace") if isinstance(value, bytes) else value
def post(payload, timeout=35):
    global conn
    body=json.dumps(payload).encode()
    if conn is None: conn=connect(timeout)
    try:
        # Named explicitly: edge networks block some library defaults (Python-urllib).
        conn.request("POST", parts.path, body, {"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json","Content-Length":str(len(body)),"User-Agent":"VControlHub-Agent/"+VERSION+" (linux)"})
        response=conn.getresponse(); data=response.read()
    except BaseException:
        # http.client resets itself only on ConnectionError: after a read
        # timeout every later request raised CannotSendRequest, and a job's
        # heartbeats (cancellation, metrics) failed until the job ended.
        try: conn.close()
        except Exception: pass
        conn=None
        raise
    if response.status != 200: raise HubStatus(response.status)
    return json.loads(text(data) or "{}")
def fit(value, limit):
    # The hub caps the JSON body, where escapes grow non-ASCII and control
    # characters up to six bytes each: cut by the encoded size.
    value=text(value)[:limit]
    while value and len(json.dumps(value)) > limit+2: value=value[:len(value)*4//5]
    return value
def metrics_due():
    return last_metrics is None or time.monotonic()-last_metrics >= 60
def collect_metrics():
    # A slow or failing collection must not cost the heartbeat.
    global metrics_error
    try:
        result=subprocess.run(["/bin/sh","-c",MONITOR],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15)
        metrics_error=None
        return text(result.stdout)[:64000]
    except Exception as exc:
        metrics_error=("metrics collection failed: %s" % exc)[:1000]
        return None
class Capture(object):
    # One pipe read on its own thread, keeping at most \`limit\` bytes: a command
    # that floods its output cannot exhaust the agent's memory.
    def __init__(self, stream, limit):
        self.limit=limit
        self.data=bytearray()
        self.thread=threading.Thread(target=self.pump, args=(stream,))
        self.thread.daemon=True
        self.thread.start()
    def pump(self, stream):
        try:
            while True:
                chunk=stream.read1(65536)
                if not chunk: break
                room=self.limit-len(self.data)
                if room > 0: self.data+=chunk[:room]
        except Exception: pass
        finally:
            try: stream.close()
            except Exception: pass
    def wait(self, seconds):
        self.thread.join(max(0, seconds))
        return not self.thread.is_alive()
    def release(self):
        # Reported: keep draining a pipe a background process still holds, store nothing.
        self.limit=0
        self.data=bytearray()
def terminate(proc, captures):
    # The whole group: the shell may have exited while children still own its pipes.
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try: os.killpg(proc.pid, sig)
        except OSError: pass
        end=time.monotonic()+5
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: continue
        if all(capture.wait(end-time.monotonic()) for capture in captures): return
def job_heartbeat(job):
    # A long job keeps the hub's metrics fresh too: without them the node read
    # as offline (metrics older than 3 minutes) while its heartbeat arrived.
    global last_metrics
    payload={"version":VERSION,"heartbeatJobId":job["id"]}
    if metrics_due():
        last_metrics=time.monotonic()
        raw=collect_metrics()
        if raw is not None: payload["metricsRaw"]=raw
    return payload
def run(job):
    timeout_seconds=max(1,min(int(job.get("timeoutMs",60000))/1000,3600))
    try:
        proc=subprocess.Popen(["/bin/sh","-c",job["command"]],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    except OSError as exc:
        # A command that cannot start (one argument over 128 KiB: E2BIG) is
        # reported as failed. Unreported, the hub waited out the job's timeout.
        return {"jobId":job["id"],"stdout":"","stderr":fit("Agent could not start the command: %s" % exc,ERROR_LIMIT),"exitCode":126}
    out=Capture(proc.stdout,OUTPUT_LIMIT)
    err=Capture(proc.stderr,ERROR_LIMIT)
    # Monotonic: a clock step during the job must not stretch or cut its time.
    deadline=time.monotonic()+timeout_seconds
    outcome=None
    held=False
    try:
        while True:
            remaining=deadline-time.monotonic()
            if remaining <= 0:
                outcome="timed out"
                break
            try:
                proc.wait(timeout=min(HEARTBEAT_SECONDS,remaining))
                break
            except subprocess.TimeoutExpired:
                pass
            if time.monotonic() >= deadline:
                outcome="timed out"
                break
            try:
                heartbeat=post(job_heartbeat(job))
            except Exception:
                heartbeat={}
            if heartbeat.get("cancelled"):
                outcome="cancelled"
                break
        if outcome is None:
            # The shell has ended. A process it left in the background may hold
            # the output pipes for as long as it runs: reading to their end
            # waited for it, until the job's timeout killed it.
            grace_end=time.monotonic()+min(OUTPUT_GRACE_SECONDS,max(0,deadline-time.monotonic()))
            held=not (out.wait(grace_end-time.monotonic()) and err.wait(grace_end-time.monotonic()))
    except AgentStop:
        outcome="stopped"
    if outcome is not None: terminate(proc,(out,err))
    code=proc.poll()
    # A signal shows as a negative code; the hub takes 0-255, as a shell reports it.
    if code is None: code=137
    elif code < 0: code=min(255,128-code)
    result={"jobId":job["id"],"stdout":fit(bytes(out.data),OUTPUT_LIMIT),"stderr":fit(bytes(err.data),ERROR_LIMIT),"exitCode":code}
    if outcome == "cancelled": result.update(stderr="Agent command cancelled",exitCode=130)
    elif outcome == "timed out": result.update(stderr="Agent command timed out",exitCode=124)
    elif outcome == "stopped": result.update(stderr="Agent stopped (service stop or restart) while the command ran",exitCode=143)
    elif held: result["stderr"]=fit(result["stderr"]+("\\n" if result["stderr"] else "")+"[agent] output written after the command ended was not collected: a process it left in the background kept the output open",ERROR_LIMIT)
    out.release()
    err.release()
    return result
def apply_update(update):
    # The hub's build with this agent's own token, swapped in place: the
    # process restarts itself (same PID), so the service is not restarted and
    # processes that jobs left running are not killed with it.
    global update_error
    version=str(update.get("version") or "")
    if not version or version == VERSION: return
    if time.monotonic()-update_failed.get(version,-UPDATE_RETRY_SECONDS) < UPDATE_RETRY_SECONDS: return
    temp=SCRIPT+".new"
    try:
        lines=base64.b64decode(update["script"]).decode("utf-8").split("\\n")
        marks=[i for i, line in enumerate(lines) if line.startswith("TOKEN=")]
        if len(marks) != 1 or lines[marks[0]] != "TOKEN="+json.dumps(PLACEHOLDER): raise ValueError("no token placeholder")
        if "VERSION="+json.dumps(version) not in lines: raise ValueError("version mismatch")
        lines[marks[0]]="TOKEN="+json.dumps(TOKEN)
        source="\\n".join(lines)
        compile(source, SCRIPT, "exec")
        fd=os.open(temp, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o700)
        with os.fdopen(fd, "w") as handle:
            handle.write(source)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, 0o700)
        os.replace(temp, SCRIPT)
    except Exception as exc:
        update_error=("self-update to %s failed: %s" % (version, exc))[:1000]
        update_failed[version]=time.monotonic()
        try: os.unlink(temp)
        except OSError: pass
        return
    try:
        if conn: conn.close()
    except Exception: pass
    try:
        os.execv(sys.executable, [sys.executable, SCRIPT])
    except OSError as exc:
        update_error=("self-update to %s installed; restart failed: %s" % (version, exc))[:1000]
        update_failed[version]=time.monotonic()
def shutdown():
    # Hand in a finished job's result without taking a new job, then leave.
    global conn
    if pending is not None:
        try:
            conn=None
            post({"version":VERSION,"capabilities":CAPABILITIES,"result":pending,"stopping":True}, timeout=10)
        except BaseException: pass
    sys.exit(0)
try: signal.signal(signal.SIGTERM, on_stop)
except ValueError: pass
while True:
    try:
        try:
            payload={"version":VERSION,"capabilities":CAPABILITIES}
            if pending is not None: payload["result"]=pending
            if metrics_due():
                last_metrics=time.monotonic()
                raw=collect_metrics()
                if raw is not None: payload["metricsRaw"]=raw
            problems=[problem for problem in (metrics_error, update_error) if problem]
            if problems: payload["error"]="; ".join(problems)[:1000]
            recent=[version for version, at in update_failed.items() if time.monotonic()-at < UPDATE_RETRY_SECONDS]
            if recent: payload["updateFailed"]=recent[-1]
            try:
                message=post(payload)
            except HubStatus as exc:
                if exc.status == 400 and pending is not None:
                    # Resending a result the hub refuses would block every later
                    # job: report the job as failed instead, once.
                    pending=None if pending["stderr"] == REJECTED else {"jobId":pending["jobId"],"stdout":"","stderr":REJECTED,"exitCode":1}
                raise
            pending=None
            job=message.get("job")
            if job: pending=run(job)
            elif message.get("update"): apply_update(message["update"])
            else: time.sleep(max(1,min(int(message.get("pollAfterMs",5000))/1000,30)))
            if stopping: shutdown()
        except Exception as exc:
            try:
                if conn: conn.close()
            except Exception: pass
            conn=None
            status=getattr(exc,"status",None)
            # 401: the token was revoked (reinstalled or removed); 403: an edge
            # proxy refuses. Neither changes within seconds, so ask again rarely.
            time.sleep(60 if status in (401,403) else 30 if status == 429 else 5)
    except AgentStop:
        shutdown()
`;
}

/** Stands in for the token in a self-update template; the Agent puts its own back. */
export const AGENT_TOKEN_PLACEHOLDER = "__VCH_AGENT_TOKEN__";

/**
 * The hub's Linux Agent build for an Agent that runs another one and can
 * install it (1.5.0 on), or null. Offered only on an idle poll, so no job is
 * running, and only when the Agent reached this hub at the address the build
 * would point it to: a changed hub address must not move every Agent at once
 * to an address their networks may not reach. An Agent that failed to install
 * this version says so and is left alone until it asks again.
 */
export function agentSelfUpdateFor(report: {
  version?: string;
  capabilities?: string[];
  updateFailed?: string;
  requestHost?: string | null;
}): { version: string; script: string } | null {
  if (!report.capabilities?.includes("self-update")) return null;
  if (!report.version || report.version === AGENT_VERSION || report.updateFailed === AGENT_VERSION) return null;
  const hubUrl = config.app.baseUrl;
  if (!hubUrl) return null;
  const parsed = new URL(hubUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return null;
  const requestHostname = report.requestHost?.split(",")[0]?.trim().toLowerCase().replace(/:\d+$/, "");
  if (!requestHostname || requestHostname !== parsed.hostname.toLowerCase()) return null;
  return {
    version: AGENT_VERSION,
    script: Buffer.from(buildAgentPython(hubUrl, AGENT_TOKEN_PLACEHOLDER)).toString("base64"),
  };
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
    POWERSHELL_ENABLE_TLS12,
    "Add-Type -AssemblyName System.Net.Http | Out-Null",
    `$ENDPOINT = ${JSON.stringify(endpoint)}`,
    `$TOKEN = ${JSON.stringify(token)}`,
    `$VERSION = ${JSON.stringify(AGENT_VERSION)}`,
    "$HEARTBEAT_SECONDS = 20",
    "$OUTPUT_LIMIT = 8388608",
    "$ERROR_LIMIT = 1048576",
    "$REJECTED = 'Agent result rejected by the hub'",
    "$script:LastStatus = 0",
    "",
    "$script:Client = New-Object System.Net.Http.HttpClient",
    "$script:Client.Timeout = [TimeSpan]::FromSeconds(35)",
    "# Named explicitly: edge networks block some library defaults.",
    "$null = $script:Client.DefaultRequestHeaders.TryAddWithoutValidation('User-Agent', 'VControlHub-Agent/' + $VERSION + ' (windows)')",
    "",
    "function Invoke-AgentPost {",
    "  param([string]$Json)",
    "  $script:LastStatus = 0",
    "  $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $ENDPOINT)",
    "  $null = $request.Headers.TryAddWithoutValidation('Authorization', 'Bearer ' + $TOKEN)",
    "  $request.Content = New-Object System.Net.Http.StringContent($Json, [System.Text.Encoding]::UTF8, 'application/json')",
    "  $response = $script:Client.SendAsync($request).GetAwaiter().GetResult()",
    "  try {",
    "    $script:LastStatus = [int]$response.StatusCode",
    "    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()",
    "    if (-not $response.IsSuccessStatusCode) { throw ('hub returned ' + $script:LastStatus) }",
    "    if ([string]::IsNullOrWhiteSpace($body)) { return $null }",
    "    return ($body | ConvertFrom-Json)",
    "  } finally {",
    "    $request.Dispose()",
    "    $response.Dispose()",
    "  }",
    "}",
    "",
    "function Limit-Text {",
    "  param([string]$Value, [int]$Limit)",
    "  if ($null -eq $Value) { return '' }",
    "  if ($Value.Length -gt $Limit) { $Value = $Value.Substring(0, $Limit) }",
    "  # The hub caps the JSON body: cut by the encoded size, not the character count.",
    "  while ($Value.Length -gt 0 -and [System.Text.Encoding]::UTF8.GetByteCount((ConvertTo-Json $Value -Compress)) -gt $Limit + 2) {",
    "    $Value = $Value.Substring(0, [int][Math]::Floor($Value.Length * 0.8))",
    "  }",
    "  return $Value",
    "}",
    "",
    "# systemd-detect-virt's names for the hypervisors Windows reports by maker and model.",
    "function Get-AgentVirtualization {",
    "  param($System)",
    "  if (-not $System) { return '' }",
    "  $signature = ([string]$System.Manufacturer + ' ' + [string]$System.Model).ToLowerInvariant()",
    "  if ($signature -match 'kvm|qemu|standard pc') { return 'kvm' }",
    "  if ($signature -match 'vmware') { return 'vmware' }",
    "  if ($signature -match 'virtualbox') { return 'oracle' }",
    "  if ($signature -match 'xen') { return 'xen' }",
    "  if ($signature -match 'amazon ec2') { return 'amazon' }",
    "  if ($signature -match 'google') { return 'google' }",
    "  if ($signature -match 'microsoft corporation virtual machine') { return 'microsoft' }",
    "  if ($System.HypervisorPresent) { return '' }",
    "  return 'none'",
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
    "  # Host facts, as the Linux script reports them (see host-facts.ts).",
    "  $lines.Add('===SYS===')",
    "  $arch = [string]$env:PROCESSOR_ARCHITECTURE",
    "  if ($arch -eq 'AMD64') { $arch = 'x86_64' } elseif ($arch -eq 'ARM64') { $arch = 'aarch64' } elseif ($arch -eq 'x86') { $arch = 'i686' }",
    "  $lines.Add('arch=' + $arch)",
    "  $lines.Add('kernel=' + [string]$osInfo.Version)",
    "  $lines.Add('os=' + [string]$osInfo.Caption)",
    "  $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1",
    "  if ($cpu) { $lines.Add('cpu=' + ([string]$cpu.Name).Trim()) }",
    "  $lines.Add('virt=' + (Get-AgentVirtualization (Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue)))",
    "  $lines.Add('procs=' + [string](@(Get-Process -ErrorAction SilentlyContinue)).Count)",
    "  $lines.Add('tcp=' + [string](@(Get-NetTCPConnection -ErrorAction SilentlyContinue)).Count)",
    "  $lines.Add('udp=' + [string](@(Get-NetUDPEndpoint -ErrorAction SilentlyContinue)).Count)",
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
    "        $beatPayload = @{ version = $VERSION; heartbeatJobId = [string]$Job.id }",
    "        # A long job keeps the hub's metrics fresh too (they expire after 3 minutes).",
    "        if (([DateTime]::UtcNow - $script:lastMetrics).TotalSeconds -ge 60) {",
    "          $script:lastMetrics = [DateTime]::UtcNow",
    "          try { $raw = Get-AgentMetrics; if ($raw) { $beatPayload['metricsRaw'] = $raw.Substring(0, [Math]::Min(64000, $raw.Length)) } } catch { }",
    "        }",
    "        $beat = Invoke-AgentPost (($beatPayload | ConvertTo-Json -Compress))",
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
    "  # A process the command left in the background holds the output pipes as long",
    "  # as it runs, and reading to their end waited for it (forever for a server).",
    "  $held = $false",
    "  try { if ($stdoutTask.Wait(10000)) { $stdout = $stdoutTask.Result } else { $held = $true } } catch { }",
    "  try { if ($stderrTask.Wait(10000)) { $stderr = $stderrTask.Result } else { $held = $true } } catch { }",
    "  # Hub protocol caps exitCode at 255; Windows exit codes are 32-bit.",
    "  $exitCode = $process.ExitCode",
    "  if ($cancelled) { $exitCode = 130; $stderr = 'Agent command cancelled' }",
    "  elseif ($timedOut) { $exitCode = 124; $stderr = 'Agent command timed out' }",
    "  elseif ($exitCode -lt 0 -or $exitCode -gt 255) { $exitCode = 1 }",
    "  if ($held -and -not $cancelled -and -not $timedOut) {",
    "    if ($stderr) { $stderr = $stderr + [string][char]10 }",
    "    $stderr = $stderr + '[agent] the output was not collected: a process the command left in the background kept it open'",
    "  }",
    "  return [ordered]@{ jobId = [string]$Job.id; stdout = (Limit-Text $stdout $OUTPUT_LIMIT); stderr = (Limit-Text $stderr $ERROR_LIMIT); exitCode = $exitCode }",
    "}",
    "",
    "$pending = $null",
    "$lastMetrics = [DateTime]::MinValue",
    "$metricsError = $null",
    "while ($true) {",
    "  $sleepMilliseconds = 5000",
    "  try {",
    `    $payload = [ordered]@{ version = $VERSION; capabilities = @(${[...AGENT_CAPABILITIES].map((c) => `'${c}'`).join(", ")}) }`,
    "    if ($null -ne $pending) { $payload['result'] = $pending }",
    "    $now = [DateTime]::UtcNow",
    "    if (($now - $lastMetrics).TotalSeconds -ge 60) {",
    "      $lastMetrics = $now",
    "      try {",
    "        $raw = Get-AgentMetrics",
    "        if ($raw) { $payload['metricsRaw'] = $raw.Substring(0, [Math]::Min(64000, $raw.Length)) }",
    "        $metricsError = $null",
    "      } catch {",
    "        $metricsError = 'metrics collection failed: ' + $_.Exception.Message",
    "      }",
    "    }",
    "    if ($metricsError) { $payload['error'] = $metricsError.Substring(0, [Math]::Min(1000, $metricsError.Length)) }",
    "    try {",
    "      $message = Invoke-AgentPost ($payload | ConvertTo-Json -Depth 6 -Compress)",
    "    } catch {",
    "      if ($script:LastStatus -eq 400 -and $null -ne $pending) {",
    "        # Resending a result the hub refuses would block every later job: report the job as failed instead, once.",
    "        if ($pending.stderr -eq $REJECTED) { $pending = $null }",
    "        else { $pending = [ordered]@{ jobId = $pending.jobId; stdout = ''; stderr = $REJECTED; exitCode = 1 } }",
    "      }",
    "      throw",
    "    }",
    "    $pending = $null",
    "    if ($message -and $message.job) {",
    "      $pending = Invoke-AgentJob $message.job",
    "      $sleepMilliseconds = 1000",
    "    } elseif ($message -and $message.pollAfterMs) {",
    "      try { $sleepMilliseconds = [Math]::Max(1000, [Math]::Min([int]$message.pollAfterMs, 30000)) } catch { }",
    "    }",
    "  } catch {",
    "    # 401: the token was revoked (reinstalled or removed); 403: an edge proxy refuses. Ask again rarely.",
    "    if ($script:LastStatus -eq 401 -or $script:LastStatus -eq 403) { $sleepMilliseconds = 60000 }",
    "    elseif ($script:LastStatus -eq 429) { $sleepMilliseconds = 30000 }",
    "    else { $sleepMilliseconds = 5000 }",
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
    `$taskName = ${JSON.stringify(AGENT_WINDOWS_TASK_NAME)}`,
    "# An installed Agent keeps its old token in memory, and Start-ScheduledTask",
    "# ignores a task that is still running: stop it, and let it end, before replacing it.",
    "try {",
    "  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue",
    "  for ($i = 0; $i -lt 20 -and (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State -eq 'Running'; $i++) { Start-Sleep -Milliseconds 500 }",
    "} catch { }",
    "$agentDir = Join-Path $env:ProgramData 'VControlHub'",
    "New-Item -ItemType Directory -Path $agentDir -Force | Out-Null",
    "$agentPath = Join-Path $agentDir 'agent.ps1'",
    `[System.IO.File]::WriteAllBytes($agentPath, [Convert]::FromBase64String(${JSON.stringify(agentBase64)}))`,
    "$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $agentPath + '\"')",
    "$trigger = New-ScheduledTaskTrigger -AtStartup",
    "# A zero execution time limit means none: the Agent runs as long as the machine does.",
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)",
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
  if (!hubUrl) throw new Error("The hub address is not configured: set DOMAIN or APP_BASE_URL to install Agent mode");
  const parsed = new URL(hubUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("Agent hub URL must use HTTPS");
  }
  const token = await issueServerAgentToken(serverId);
  const python = Buffer.from(buildAgentPython(hubUrl, token)).toString("base64");
  const unit = `[Unit]\nDescription=VControlHub Agent\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=/usr/bin/python3 /opt/vcontrolhub-agent/agent.py\nRestart=always\nRestartSec=5\nNoNewPrivileges=true\n\n[Install]\nWantedBy=multi-user.target\n`;
  const script = [
    "set -e",
    `command -v python3 >/dev/null 2>&1 || { echo "The Agent needs python3" >&2; exit 1; }`,
    `python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 5) else 1)' || { echo "The Agent needs Python 3.5 or newer" >&2; exit 1; }`,
    `command -v systemctl >/dev/null 2>&1 || { echo "The Agent needs systemd" >&2; exit 1; }`,
    "install -d -m 700 /opt/vcontrolhub-agent",
    `printf %s ${shellQuote(python)} | base64 -d > /opt/vcontrolhub-agent/agent.py`,
    "chmod 700 /opt/vcontrolhub-agent/agent.py",
    `printf %s ${shellQuote(unit)} > /etc/systemd/system/vcontrolhub-agent.service`,
    "systemctl daemon-reload",
    "systemctl enable vcontrolhub-agent.service >/dev/null",
    // An installed Agent keeps its previous token in memory: restart, not just start.
    "systemctl restart vcontrolhub-agent.service",
  ].join("\n");
  const ssh = await buildSshParamsFromServer(server, server.sshKey);
  const result = await execRemoteCommand({ ...ssh, command: asRoot(script), timeout: 60_000 });
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
  if (!hubUrl) throw new Error("The hub address is not configured: set DOMAIN or APP_BASE_URL to install Agent mode");
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
  const installCommand = `${POWERSHELL_ENABLE_TLS12}; & ([scriptblock]::Create((Invoke-RestMethod -UseBasicParsing -Uri '${bootstrapUrl}' -Headers @{ Authorization = 'Bearer ${token}' })))`;
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
  let removed = false;
  if (server.agentLastSeenAt && Date.now() - server.agentLastSeenAt.getTime() < AGENT_FRESH_MS) {
    const result = await executeCommandWithAgent({
      serverId,
      command: AGENT_CLEANUP_COMMAND,
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
        const result = await execRemoteCommand({ ...ssh, command: asRoot(AGENT_SSH_CLEANUP_SCRIPT), timeout: 30_000 });
        removed = result.exitCode === 0;
      }
    }
  } catch {
    removed = false;
  } finally {
    await prisma.server.update({ where: { id: serverId }, data: { agentTokenHash: null } });
  }
  return { removed };
}
