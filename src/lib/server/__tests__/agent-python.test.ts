/** @vitest-environment node */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));

import { AGENT_TOKEN_PLACEHOLDER, buildAgentPython } from "../agent-service";
import { AGENT_VERSION } from "../agent-version";

const hasPython = process.platform !== "win32" && spawnSync("python3", ["--version"]).status === 0;
const TOKEN = "vca_srv1_abcdefghijklmnopqrstuvwxyz0123456789ABCD";

type Poll = { headers: IncomingHttpHeaders; body: Record<string, unknown> };

type Reply = { status: number; body: unknown };

/** A fake hub answering polls from `replies`, then idling the Agent at 5 s. */
async function startHub(replies: Reply[]) {
  const polls: Poll[] = [];
  const hub = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      polls.push({ headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> });
      const reply = replies.shift() ?? { status: 200, body: { pollAfterMs: 5000, job: null } };
      response.writeHead(reply.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", resolve));
  return {
    polls,
    url: `http://127.0.0.1:${(hub.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => hub.close(() => resolve())),
  };
}

const resultOf = (polls: Poll[]) => polls.map((poll) => poll.body.result as Record<string, unknown> | undefined).find(Boolean);

// The real agent.py against a fake hub: what the Linux Agent sends and how it
// survives output that is not UTF-8, a job killed by a signal and a revoked token.
describe.skipIf(!hasPython)("Linux Agent (agent.py) against a fake hub", () => {
  it("reports metrics, survives odd job output, and backs off once its token is revoked", async () => {
    const polls: Poll[] = [];
    const replies: Array<{ status: number; body: unknown }> = [
      { status: 200, body: { pollAfterMs: 0, job: { id: "job1", command: "printf 'caf\\377 ok'; exit 3", timeoutMs: 5000 } } },
      { status: 200, body: { pollAfterMs: 0, job: { id: "job2", command: "kill -9 $$", timeoutMs: 5000 } } },
      { status: 401, body: { error: "Unauthorized agent" } },
    ];
    const hub = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        polls.push({ headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> });
        const reply = replies.shift() ?? { status: 200, body: { pollAfterMs: 5000, job: null } };
        response.writeHead(reply.status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", resolve));
    const dir = mkdtempSync(join(tmpdir(), "vch-agent-"));
    const script = join(dir, "agent.py");
    writeFileSync(script, buildAgentPython(`http://127.0.0.1:${(hub.address() as AddressInfo).port}`, TOKEN));
    const agent = spawn("python3", [script], { stdio: "ignore" });
    try {
      await expect.poll(() => polls.length, { timeout: 15_000 }).toBe(3);
      const [first, second, third] = polls;
      expect(first!.headers["user-agent"]).toBe(`VControlHub-Agent/${AGENT_VERSION} (linux)`);
      expect(first!.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(first!.body).toMatchObject({ version: AGENT_VERSION, capabilities: ["metrics", "command", "self-update"] });
      expect(String(first!.body.metricsRaw)).toContain("===CPU===");
      // Invalid UTF-8 is replaced, not fatal to the job.
      expect(second!.body.result).toEqual({ jobId: "job1", stdout: "caf� ok", stderr: "", exitCode: 3 });
      // SIGKILL is -9 to Python; the hub only takes 0-255, as a shell reports it.
      expect(third!.body.result).toMatchObject({ jobId: "job2", exitCode: 137 });
      // After the 401 the next attempt is a minute away, not five seconds.
      await new Promise((resolve) => setTimeout(resolve, 6_500));
      expect(polls).toHaveLength(3);
    } finally {
      agent.kill("SIGKILL");
      await new Promise<void>((resolve) => hub.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("reports a command too long to start instead of leaving its job unanswered", async () => {
    // `sh -c <command>` is one argument, capped at 128 KiB by Linux: Popen
    // raised E2BIG, the job was never reported and the hub waited out its timeout.
    const polls: Poll[] = [];
    const replies: Array<{ status: number; body: unknown }> = [
      { status: 200, body: { pollAfterMs: 0, job: { id: "huge", command: `printf %s ${"x".repeat(200 * 1024)}`, timeoutMs: 5000 } } },
    ];
    const hub = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        polls.push({ headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> });
        const reply = replies.shift() ?? { status: 200, body: { pollAfterMs: 5000, job: null } };
        response.writeHead(reply.status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", resolve));
    const dir = mkdtempSync(join(tmpdir(), "vch-agent-"));
    const script = join(dir, "agent.py");
    writeFileSync(script, buildAgentPython(`http://127.0.0.1:${(hub.address() as AddressInfo).port}`, TOKEN));
    const agent = spawn("python3", [script], { stdio: "ignore" });
    try {
      await expect.poll(() => polls.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
      expect(polls[1]!.body.result).toMatchObject({ jobId: "huge", exitCode: 126 });
      expect(String((polls[1]!.body.result as { stderr: string }).stderr)).toContain("could not start");
    } finally {
      agent.kill("SIGKILL");
      await new Promise<void>((resolve) => hub.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("drops a connection whose request failed, so the next heartbeat reconnects", () => {
    // http.client resets only on ConnectionError: after a read timeout every
    // later request raised CannotSendRequest until the job ended.
    const dir = mkdtempSync(join(tmpdir(), "vch-agent-"));
    try {
      const script = join(dir, "agent.py");
      writeFileSync(script, buildAgentPython("http://127.0.0.1:9", TOKEN));
      const harness = join(dir, "harness.py");
      writeFileSync(harness, [
        "import sys",
        "src = open(sys.argv[1]).read().split('\\nwhile True:\\n')[0]",
        "g = {}",
        "exec(src, g)",
        "class TimedOut:",
        "    closed = False",
        "    def request(self, *args, **kwargs): raise TimeoutError('timed out')",
        "    def close(self): TimedOut.closed = True",
        "g['conn'] = TimedOut()",
        "try:",
        "    g['post']({'version': 'x'})",
        "except TimeoutError:",
        "    pass",
        "print('reset' if g['conn'] is None and TimedOut.closed else 'kept')",
      ].join("\n"));
      const result = spawnSync("python3", [harness, script], { encoding: "utf8" });
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe("reset");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs the hub's build with its own token and restarts in place", async () => {
    // Before 1.5.0 an Agent kept its build until it was reinstalled over SSH,
    // and an Agent without SSH credentials could not be upgraded at all.
    const replies: Reply[] = [];
    const hub = await startHub(replies);
    const update = Buffer.from(buildAgentPython(hub.url, AGENT_TOKEN_PLACEHOLDER)).toString("base64");
    replies.push({ status: 200, body: { pollAfterMs: 0, job: null, update: { version: AGENT_VERSION, script: update } } });
    const dir = mkdtempSync(join(tmpdir(), "vch-agent-"));
    const script = join(dir, "agent.py");
    writeFileSync(script, buildAgentPython(hub.url, TOKEN).replace(`VERSION=${JSON.stringify(AGENT_VERSION)}`, 'VERSION="1.4.9"'));
    const agent = spawn("python3", [script], { stdio: "ignore" });
    try {
      await expect.poll(() => hub.polls.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
      expect(hub.polls[0]!.body.version).toBe("1.4.9");
      expect(hub.polls[1]!.body.version).toBe(AGENT_VERSION);
      expect(hub.polls[1]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
      const installed = readFileSync(script, "utf8");
      expect(installed).toContain(`TOKEN=${JSON.stringify(TOKEN)}`);
      expect(installed).not.toContain(AGENT_TOKEN_PLACEHOLDER);
      // The same process carries on: the service was not restarted.
      expect(agent.exitCode).toBeNull();
    } finally {
      agent.kill("SIGKILL");
      await hub.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps its build and says so when an update cannot be installed", async () => {
    const replies: Reply[] = [
      { status: 200, body: { pollAfterMs: 0, job: null, update: { version: "9.9.9", script: Buffer.from("print('no token here')").toString("base64") } } },
      { status: 200, body: { pollAfterMs: 0, job: null } },
    ];
    const hub = await startHub(replies);
    const dir = mkdtempSync(join(tmpdir(), "vch-agent-"));
    const script = join(dir, "agent.py");
    writeFileSync(script, buildAgentPython(hub.url, TOKEN));
    const agent = spawn("python3", [script], { stdio: "ignore" });
    try {
      await expect.poll(() => hub.polls.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
      // The hub stops offering it while the Agent reports the failure.
      expect(hub.polls[1]!.body).toMatchObject({ version: AGENT_VERSION, updateFailed: "9.9.9" });
      expect(String(hub.polls[1]!.body.error)).toContain("self-update to 9.9.9 failed");
      expect(readFileSync(script, "utf8")).toContain(`TOKEN=${JSON.stringify(TOKEN)}`);
      expect(agent.exitCode).toBeNull();
    } finally {
      agent.kill("SIGKILL");
      await hub.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("stops a running command and reports it when its service stops", async () => {
    // A stop or restart used to leave the job unreported: the hub waited out
    // its lease and recorded an unknown outcome.
    const dir = mkdtempSync(join(tmpdir(), "vch-agent-"));
    const pidFile = join(dir, "pid");
    const hub = await startHub([{ status: 200, body: { pollAfterMs: 0, job: { id: "long", command: `echo $$ > ${pidFile}; sleep 30`, timeoutMs: 60_000 } } }]);
    const script = join(dir, "agent.py");
    writeFileSync(script, buildAgentPython(hub.url, TOKEN));
    const agent = spawn("python3", [script], { stdio: "ignore" });
    const exited = new Promise<number | null>((resolve) => agent.on("exit", (code) => resolve(code)));
    try {
      await expect.poll(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "", { timeout: 15_000 }).toBe(true);
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      agent.kill("SIGTERM");
      expect(await exited).toBe(0);
      // It hands the result in without taking another job, and the command is gone.
      expect(hub.polls.at(-1)!.body).toMatchObject({ stopping: true, result: { jobId: "long", exitCode: 143 } });
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      agent.kill("SIGKILL");
      await hub.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("reports a job when its shell ends, not when a process it left running does", async () => {
    // A background process holds the output pipes; reading to their end waited
    // for it until the job's timeout killed it (and forever if it had left the
    // process group).
    const dir = mkdtempSync(join(tmpdir(), "vch-agent-"));
    const groupFile = join(dir, "group");
    const hub = await startHub([{ status: 200, body: { pollAfterMs: 0, job: { id: "bg", command: `echo $$ > ${groupFile}; (sleep 25) & echo started`, timeoutMs: 60_000 } } }]);
    const script = join(dir, "agent.py");
    writeFileSync(script, buildAgentPython(hub.url, TOKEN));
    const started = Date.now();
    const agent = spawn("python3", [script], { stdio: "ignore" });
    try {
      await expect.poll(() => resultOf(hub.polls), { timeout: 20_000 }).toBeTruthy();
      expect(Date.now() - started).toBeLessThan(18_000);
      const result = resultOf(hub.polls)!;
      expect(result).toMatchObject({ jobId: "bg", stdout: "started\n", exitCode: 0 });
      expect(String(result.stderr)).toContain("kept the output open");
    } finally {
      agent.kill("SIGKILL");
      try { process.kill(-Number(readFileSync(groupFile, "utf8").trim()), "SIGKILL"); } catch { /* already gone */ }
      await hub.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps a flooding command's output, and the Agent's memory, bounded", async () => {
    // All output used to be read into memory before it was cut to 8 MiB.
    const hub = await startHub([{ status: 200, body: { pollAfterMs: 0, job: { id: "flood", command: "head -c 200000000 /dev/zero | tr '\\0' a", timeoutMs: 60_000 } } }]);
    const dir = mkdtempSync(join(tmpdir(), "vch-agent-"));
    const script = join(dir, "agent.py");
    writeFileSync(script, buildAgentPython(hub.url, TOKEN));
    const agent = spawn("python3", [script], { stdio: "ignore" });
    try {
      await expect.poll(() => resultOf(hub.polls), { timeout: 40_000 }).toBeTruthy();
      const result = resultOf(hub.polls)!;
      expect(result).toMatchObject({ jobId: "flood", exitCode: 0 });
      expect(String(result.stdout)).toHaveLength(8 * 1_048_576);
      const peakKb = Number(/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${agent.pid}/status`, "utf8"))?.[1]);
      expect(peakKb).toBeLessThan(150_000);
    } finally {
      agent.kill("SIGKILL");
      await hub.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
