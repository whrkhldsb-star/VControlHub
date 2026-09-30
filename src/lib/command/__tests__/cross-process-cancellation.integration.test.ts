// @vitest-environment node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cancelCommandRequest } from "../service-requests";

vi.mock("@/lib/audit/service", () => ({ auditSystemAction: vi.fn() }));
vi.mock("@/lib/notification/service", () => ({ notifyCommandResult: async () => undefined }));

afterAll(async () => { await prisma.$disconnect(); });

it.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("cancels another process's real child and waits for acknowledgement", async () => {
  const database = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
    throw new Error("Cancellation integration requires an isolated loopback audit/test database");
  }
  const id = `cancel-regression-${randomUUID()}`;
  const directory = await mkdtemp(path.join(tmpdir(), "vch-cancellation-"));
  const marker = path.join(directory, "delayed-side-effect");
  let worker: ReturnType<typeof spawn> | undefined;
  try {
    await prisma.user.create({ data: { id, username: id, passwordHash: "not-a-login-hash" } });
    await prisma.server.create({ data: { id, name: id, host: "192.0.2.5", username: "fixture", tags: [] } });
    await prisma.commandRequest.create({ data: { id, title: "Cancellation fixture", command: "fixture only", requesterId: id, initiatedByType: "USER", status: "RUNNING", targets: { create: { id, serverId: id, status: "RUNNING" } } } });
    const source = path.join(process.cwd(), "src/lib");
    const workerCode = `
      const { prisma } = require(${JSON.stringify(path.join(source, "db.ts"))});
      const { monitorCommandCancellation } = require(${JSON.stringify(path.join(source, "command/cancellation.ts"))});
      const { runSshCommandProcess } = require(${JSON.stringify(path.join(source, "command/ssh-executor.ts"))});
      (async () => {
        const controller = new AbortController();
        const stop = await monitorCommandCancellation(${JSON.stringify(id)}, controller);
        const command = ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'should never happen'), 10000)`)};
        const execution = runSshCommandProcess({ command: process.execPath, args: ['-e', command], targetId: ${JSON.stringify(id)}, signal: controller.signal, runtimeConfig: { executionTimeoutMs: 20000, outputLimitBytes: 4096 } });
        console.log('CHILD_STARTED');
        const result = await execution; stop();
        await prisma.commandTarget.update({ where: { id: ${JSON.stringify(id)} }, data: { status: result.cancelled ? 'CANCELLED' : 'COMPLETED', exitCode: result.exitCode, finishedAt: new Date() } });
        await prisma.commandRequest.update({ where: { id: ${JSON.stringify(id)} }, data: { status: result.cancelled ? 'CANCELLED' : 'COMPLETED' } });
        console.log(JSON.stringify(result)); await prisma.$disconnect();
      })().catch(error => { console.error(error.message); process.exit(1); });
    `;
    worker = spawn(process.execPath, ["--import", "tsx", "-e", workerCode], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    const exited = once(worker, "exit");
    worker.stderr!.on("data", (chunk) => { errors += chunk.toString(); });
    await new Promise<void>((resolve, reject) => {
      worker!.stdout!.on("data", (chunk) => { output += chunk.toString(); if (output.includes("CHILD_STARTED")) resolve(); });
      worker!.once("error", reject);
      worker!.once("exit", () => { if (!output.includes("CHILD_STARTED")) reject(new Error(errors || "Worker exited before child started")); });
    });
    const cancelled = await cancelCommandRequest({ commandRequestId: id, actorId: id });
    expect(cancelled.status).toBe("CANCELLING");
    const [exitCode] = await exited;
    expect(exitCode, errors).toBe(0);
    expect(output).toContain('"cancelled":true');
    expect(output).toContain('"exitCode":130');
    expect(await prisma.commandRequest.findUnique({ where: { id }, select: { status: true } })).toEqual({ status: "CANCELLED" });
    await expect(access(marker)).rejects.toThrow();
  } finally {
    worker?.kill("SIGKILL");
    await prisma.commandRequest.deleteMany({ where: { id } });
    await prisma.server.deleteMany({ where: { id } });
    await prisma.user.deleteMany({ where: { id } });
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
