/** Isolated PostgreSQL + real SSH + HTTP WebDAV soak. Never targets production. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "@/lib/db";
import { getServerInventory, getServerOperationTargets } from "@/lib/server/inventory";
import { claimNextJob, completeJob } from "@/lib/job/service";
import { execRemoteCommand, closeSshPool, buildSshParamsFromServer } from "@/lib/ssh/client";
import { createWebDavClient } from "@/lib/storage/webdav-client";
import { encryptWebDavConfig } from "@/lib/storage/webdav-credentials";
import type { DownloadServer } from "@/lib/downloads/execution";

async function main() {
 const db = new URL(process.env.DATABASE_URL!);
 assert(["localhost", "127.0.0.1"].includes(db.hostname) && /audit|test|_ci/.test(db.pathname), "Isolated database required");
 const sshServer = JSON.parse(await readFile(process.env.VCH_TEST_SSH_CONFIG!, "utf8")) as DownloadServer;
 assert.equal(sshServer.host, "127.0.0.1");
 assert.notEqual(sshServer.port, 22);
 const ssh = await buildSshParamsFromServer(sshServer, sshServer.sshKey);
 const duration = Math.max(10, Number(process.env.SOAK_SECONDS ?? 1800)) * 1000;
 const concurrency = Math.min(10, Math.max(1, Number(process.env.SOAK_CONCURRENCY ?? 3)));
 const output = process.env.SOAK_OUTPUT!;
 assert(output, "SOAK_OUTPUT required");
 const prefix = `soak-${randomUUID()}`;
 const session = { userId: prefix, roles: ["viewer"] as ["viewer"], currentTeamId: prefix };
 const bodies = new Map<string, Buffer>();
 const http = createServer(async (req, res) => {
  const key = req.url!;
  if (req.method === "PUT") {
   const chunks: Buffer[] = [];
   for await (const chunk of req) chunks.push(Buffer.from(chunk));
   bodies.set(key, Buffer.concat(chunks)); res.writeHead(201).end();
  } else if (req.method === "DELETE") { bodies.delete(key); res.writeHead(204).end(); }
  else { const body = bodies.get(key); res.writeHead(body ? 200 : 404, { "Content-Length": body?.length ?? 0 }); res.end(body); }
 });
 await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
 const address = http.address() as { port: number };
 const webdav = createWebDavClient({ basePath: "/", webdavConfigEncrypted: encryptWebDavConfig({ endpoint: "https://soak.example.com/dav", authType: "bearer", token: "fixture-only" }) }, {
  transport: (url, init) => fetch(`http://127.0.0.1:${address.port}${url.pathname}`, init),
 });
 const times: Record<string, number[]> = {};
 const errors: { operation: string; message: string }[] = [];
 const samples: Record<string, number>[] = [];
 const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
 let operations = 0;
 const timed = async (name: string, fn: () => Promise<void>) => {
  const started = performance.now();
  try { await fn(); operations++; }
  catch (error) { errors.push({ operation: name, message: String(error).slice(0, 300) }); }
  (times[name] ??= []).push(performance.now() - started);
 };
 let timer: ReturnType<typeof setInterval> | undefined;
 try {
  await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "fixture-unused" } });
  await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix, ownerId: prefix } });
  await prisma.server.createMany({ data: Array.from({ length: 525 }, (_, index) => ({ id: `${prefix}-${index}`, name: `Node ${index}`, host: "192.0.2.1", username: "fixture", teamId: prefix, enabled: false, tags: [prefix] })) });
  await prisma.job.createMany({ data: Array.from({ length: concurrency }, (_, index) => ({ id: `${prefix}-job-${index}`, type: `${prefix}-${index}`, title: prefix, payload: {}, teamId: prefix })) });
  const started = performance.now();
  const sample = async () => {
   global.gc?.();
   const memory = process.memoryUsage();
   samples.push({ seconds: (performance.now() - started) / 1000, rss: memory.rss, heapUsed: memory.heapUsed, descriptors: (await readdir("/proc/self/fd")).length });
  };
  await sample();
  timer = setInterval(() => { void sample().then(() => console.log(JSON.stringify({ operations, errors: errors.length, ...samples.at(-1) }))); }, 30000);
  await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
   let round = 0;
   const body = Buffer.alloc(256 * 1024, index + 1);
   while (performance.now() - started < duration) {
    await timed("inventory", async () => {
     const result = await getServerInventory(session, { page: round % 44 + 1 });
     assert.equal(result.stats.total, 525); assert(result.servers.length <= 12);
     const targets = await getServerOperationTargets(session, "batch", { page: round % 22 + 1 });
     assert.equal(targets.total, 525); assert(targets.rows.length <= 24);
    });
    await timed("queue", async () => {
     const job = await claimNextJob({ workerId: `${prefix}-worker-${index}`, types: [`${prefix}-${index}`] });
     assert(job); assert.equal((await completeJob(job.id, job.workerId!)).count, 1);
     await prisma.jobEvent.deleteMany({ where: { jobId: job.id } });
     await prisma.job.update({ where: { id: job.id }, data: { status: "PENDING", attempts: 0, completedAt: null, availableAt: new Date() } });
    });
    await timed("ssh", async () => { assert.equal((await execRemoteCommand({ ...ssh, command: "printf soak-ok", timeout: 5000 })).stdout, "soak-ok"); });
    await timed("webdav", async () => {
     const name = `object-${index}`;
     assert.equal((await webdav.write(name, body)).byteSize, body.length);
     assert.deepEqual(await webdav.read(name), body);
     const reader = (await webdav.stream(name)).getReader();
     await reader.read(); await reader.cancel(); reader.releaseLock();
     await webdav.delete(name);
    });
    round++; await delay(250);
   }
  }));
  clearInterval(timer); timer = undefined;
  await closeSshPool(); await delay(1000); await sample();
  const latency = Object.fromEntries(Object.entries(times).map(([name, values]) => {
   values.sort((a, b) => a - b);
   return [name, { count: values.length, p95: values[Math.floor(values.length * .95)] ?? 0, p99: values[Math.floor(values.length * .99)] ?? 0, max: values.at(-1) ?? 0 }];
  }));
  const result = { seconds: (performance.now() - started) / 1000, concurrency, operations, errors, latency, samples,
   eventLoopP99Ms: (loop.percentile(99) ?? 0) / 1e6, peakRss: Math.max(...samples.map((s) => Number(s.rss ?? 0))), remainingWebdavObjects: bodies.size };
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ operations, errors: errors.length, latency, peakRss: result.peakRss, eventLoopP99Ms: result.eventLoopP99Ms }));
  assert.equal(errors.length, 0); assert.equal(bodies.size, 0);
 } finally {
  if (timer) clearInterval(timer); loop.disable(); await closeSshPool();
  http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve()));
  await prisma.job.deleteMany({ where: { title: prefix } });
  await prisma.server.deleteMany({ where: { teamId: prefix } });
  await prisma.team.deleteMany({ where: { id: prefix } });
  await prisma.user.deleteMany({ where: { id: prefix } });
  await prisma.$disconnect();
 }
}
main().catch((error) => { console.error(error); process.exit(1); });
