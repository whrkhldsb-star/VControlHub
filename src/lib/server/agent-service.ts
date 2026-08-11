import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { shellQuote } from "@/lib/shell-quote";
import { buildSshParamsFromServer, execRemoteCommand } from "@/lib/ssh/client";
import { MONITOR_SCRIPT } from "./monitor";

const AGENT_VERSION = "1.0.0";
export const AGENT_FRESH_MS = 90_000;
const AGENT_OUTPUT_LIMIT = 8 * 1_048_576;
export const AGENT_CLEANUP_COMMAND = "nohup sh -c 'sleep 2; systemctl disable vcontrolhub-agent.service >/dev/null 2>&1 || true; rm -f /etc/systemd/system/vcontrolhub-agent.service; rm -rf /opt/vcontrolhub-agent; systemctl daemon-reload >/dev/null 2>&1 || true; systemctl stop vcontrolhub-agent.service >/dev/null 2>&1 || true' >/dev/null 2>&1 &";

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
      agentCapabilities: (input.capabilities ?? ["metrics", "command", "file"]).slice(0, 20),
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
    },
  });
}

export async function claimNextServerAgentJob(serverId: string) {
  return prisma.$transaction(async (tx) => {
    const next = await tx.serverAgentJob.findFirst({
      where: { serverId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return null;
    const claimed = await tx.serverAgentJob.updateMany({
      where: { id: next.id, status: "PENDING" },
      data: { status: "CLAIMED", claimedAt: new Date() },
    });
    return claimed.count === 1 ? next : null;
  });
}

export async function executeCommandWithAgent(input: {
  serverId: string;
  commandTargetId?: string;
  command: string;
  timeoutMs: number;
}) {
  const server = await prisma.server.findUnique({
    where: { id: input.serverId },
    select: { managementMode: true, agentLastSeenAt: true },
  });
  if (
    server?.managementMode !== "AGENT" ||
    !server.agentLastSeenAt ||
    Date.now() - server.agentLastSeenAt.getTime() > AGENT_FRESH_MS
  ) return null;

  const job = await prisma.serverAgentJob.create({
    data: { serverId: input.serverId, commandTargetId: input.commandTargetId, command: input.command, timeoutMs: input.timeoutMs },
  });
  const deadline = Date.now() + input.timeoutMs + 10_000;
  while (Date.now() < deadline) {
    const current = await prisma.serverAgentJob.findUnique({ where: { id: job.id } });
    if (!current) return null;
    if (current.status === "COMPLETED" || current.status === "FAILED") {
      return { stdout: current.stdout ?? "", stderr: current.stderr ?? "", exitCode: current.exitCode ?? 255 };
    }
    if (current.status === "CANCELLED") return { stdout: "", stderr: "Agent job cancelled", exitCode: 130 };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const current = await prisma.serverAgentJob.findUnique({ where: { id: job.id } });
  if (current?.status === "PENDING") {
    await prisma.serverAgentJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    return null;
  }
  return { stdout: current?.stdout ?? "", stderr: "Agent command timed out after dispatch; SSH fallback was suppressed to avoid duplicate execution.", exitCode: 124 };
}

function buildAgentPython(hubUrl: string, token: string) {
  const endpoint = new URL("/api/agent/v1/poll", hubUrl).toString();
  return `#!/usr/bin/env python3
import http.client, json, subprocess, time, urllib.parse
ENDPOINT=${JSON.stringify(endpoint)}
TOKEN=${JSON.stringify(token)}
MONITOR=${JSON.stringify(MONITOR_SCRIPT)}
VERSION=${JSON.stringify(AGENT_VERSION)}
pending=None
last_metrics=0
parts=urllib.parse.urlsplit(ENDPOINT)
conn=None
def connect():
    cls=http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
    return cls(parts.hostname, parts.port, timeout=35)
while True:
    try:
        now=time.time()
        payload={"version":VERSION,"capabilities":["metrics","command","file"]}
        if pending is not None: payload["result"]=pending; pending=None
        if now-last_metrics >= 60:
            metrics=subprocess.run(["/bin/sh","-c",MONITOR],capture_output=True,text=True,timeout=15)
            payload["metricsRaw"]=metrics.stdout[:64000]; last_metrics=now
        body=json.dumps(payload).encode()
        if conn is None: conn=connect()
        conn.request("POST", parts.path, body, {"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json","Content-Length":str(len(body))})
        response=conn.getresponse(); data=response.read()
        if response.status != 200: raise RuntimeError("hub returned %s" % response.status)
        message=json.loads(data or b"{}")
        job=message.get("job")
        if job:
            try:
                result=subprocess.run(["/bin/sh","-c",job["command"]],capture_output=True,text=True,timeout=max(1,min(int(job.get("timeoutMs",60000))/1000,3600)))
                pending={"jobId":job["id"],"stdout":result.stdout[:8388608],"stderr":result.stderr[:1048576],"exitCode":result.returncode}
            except subprocess.TimeoutExpired as exc:
                pending={"jobId":job["id"],"stdout":(exc.stdout or "")[:8388608],"stderr":"Agent command timed out","exitCode":124}
        else: time.sleep(max(1,min(int(message.get("pollAfterMs",5000))/1000,30)))
    except Exception:
        try:
            if conn: conn.close()
        except Exception: pass
        conn=None; time.sleep(5)
`;
}

export async function installServerAgent(serverId: string) {
  const hubUrl = config.app.baseUrl;
  if (!hubUrl) throw new Error("APP_BASE_URL is required to install Agent mode");
  const parsed = new URL(hubUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("Agent hub URL must use HTTPS");
  }
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: { sshKey: { select: { privateKey: true, passphrase: true } } },
  });
  if (!server) throw new Error("Server not found");
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

export async function uninstallServerAgent(serverId: string) {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: { sshKey: { select: { privateKey: true, passphrase: true } } },
  });
  if (!server) return { removed: false };
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
