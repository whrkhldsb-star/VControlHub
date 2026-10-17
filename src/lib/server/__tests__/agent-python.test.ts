/** @vitest-environment node */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));

import { buildAgentPython } from "../agent-service";
import { AGENT_VERSION } from "../agent-version";

const hasPython = process.platform !== "win32" && spawnSync("python3", ["--version"]).status === 0;
const TOKEN = "vca_srv1_abcdefghijklmnopqrstuvwxyz0123456789ABCD";

type Poll = { headers: IncomingHttpHeaders; body: Record<string, unknown> };

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
      expect(first!.body).toMatchObject({ version: AGENT_VERSION, capabilities: ["metrics", "command"] });
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
});
