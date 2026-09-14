/** Fault injection against an isolated loopback OpenSSH/SFTP daemon and test DB. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, open, stat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "@/lib/db";
import { transferFileViaSsh2, executeDirectDownload, type DownloadServer } from "@/lib/downloads/execution";
import { hashTransferFile } from "@/lib/downloads/transfer-manifest";
import { reconcileStaleRunningDownloadTasks } from "@/lib/downloads/reconcile";
import { closeSshPool } from "@/lib/ssh/client";

const configPath = process.env.VCH_TEST_SSH_CONFIG!;
async function serverConfig() {
 const config = JSON.parse(await readFile(configPath, "utf8")) as DownloadServer;
 assert.equal(config.host, "127.0.0.1"); assert.notEqual(config.port, 22);
 return config;
}
const prefix = `crash-${randomUUID()}`;
function child(mode: string, args: string[]) {
 const process = spawn(globalThis.process.execPath, ["--env-file=.env.local", "--import", "tsx", "scripts/load/openssh-recovery.ts", mode, ...args], { stdio: ["ignore", "pipe", "pipe"] });
 let output = "";
 process.stdout!.on("data", (data) => { output = (output + data).slice(-4000); });
 process.stderr!.on("data", (data) => { output = (output + data).slice(-4000); });
 const result = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
  process.on("error", reject); process.on("exit", (code, signal) => { if (code && code !== 0) console.error(output); resolve({ code, signal }); });
 });
 return { process, result };
}
async function until(check: () => Promise<boolean>, ms = 30000) {
 const end = Date.now() + ms;
 while (Date.now() < end) { if (await check()) return; await delay(10); }
 throw new Error("Fault-injection condition timed out");
}
async function main() {
 const db = new URL(process.env.DATABASE_URL!);
 assert(["127.0.0.1", "localhost"].includes(db.hostname) && /audit|test|_ci/.test(db.pathname));
 const server = await serverConfig();
 if (process.argv[2] === "transfer-child") {
  await transferFileViaSsh2(server, process.argv[3]!, process.argv[4]!, process.argv[5]!, undefined, process.argv[6]!);
  await closeSshPool(); await prisma.$disconnect(); return;
 }
 if (process.argv[2] === "direct-child") {
  const original = prisma.downloadTask.updateMany.bind(prisma.downloadTask);
  prisma.downloadTask.updateMany = ((args: Parameters<typeof original>[0]) => {
   if (args.data.pid) process.kill(process.pid, "SIGKILL");
   return original(args);
  }) as unknown as typeof original;
  await executeDirectDownload(process.argv[3]!, server, process.argv[4]!, process.argv[5]!, "direct.bin", undefined,
   { hostname: "127.0.0.1", address: "127.0.0.1", port: 80 });
  throw new Error("Expected to die before PID persistence");
 }
 const directory = await mkdtemp(path.join(tmpdir(), "vch-openssh-crash-"));
 const local = path.join(directory, "source.bin"), remote = path.join(directory, "target.bin");
 let activeChild: ChildProcess | undefined;
 let http: ReturnType<typeof createServer> | undefined;
 const checks: string[] = [];
 try {
  const file = await open(local, "w");
  const block = Buffer.alloc(1024 * 1024, 73);
  for (let index = 0; index < 128; index++) await file.write(block);
  await file.close();
  const digest = await hashTransferFile(local);
  await writeFile(remote, "original-destination");
  const transfer = child("transfer-child", [local, remote, prefix, digest]); activeChild = transfer.process;
  await until(async () => {
   for (const name of await readdir(directory)) if (name.startsWith(".vch-") && name.endsWith(".part")) {
    const size = (await stat(path.join(directory, name))).size;
    if (size > 0 && size < 128 * 1024 * 1024) return true;
   }
   return false;
  });
  transfer.process.kill("SIGKILL"); assert.equal((await transfer.result).signal, "SIGKILL"); activeChild = undefined;
  assert.equal(await readFile(remote, "utf8"), "original-destination");
  checks.push("SIGKILL during SFTP keeps original destination intact");
  await transferFileViaSsh2(server, local, remote, prefix, undefined, digest);
  assert.equal(await hashTransferFile(remote), digest);
  assert(!(await readdir(directory)).some((name) => name.endsWith(".part")));
  checks.push("Replacement executor publishes verified content and removes abandoned stages");
  const before = (await stat(remote)).mtimeMs;
  await rm(local);
  await transferFileViaSsh2(server, local, remote, prefix, undefined, digest);
  assert.equal((await stat(remote)).mtimeMs, before);
  checks.push("Resume after publication succeeds without local data or duplicate write");
  await writeFile(local, "corrupt-source"); await writeFile(remote, "preserve-on-mismatch");
  await assert.rejects(transferFileViaSsh2(server, local, remote, prefix, undefined, digest));
  assert.equal(await readFile(remote, "utf8"), "preserve-on-mismatch");
  checks.push("Checksum mismatch cannot replace the destination");
  await writeFile(local, "");
  await transferFileViaSsh2(server, local, remote, prefix);
  assert.equal((await stat(remote)).size, 0);
  checks.push("Zero-byte SFTP publication succeeds");

  const payload = Buffer.alloc(64 * 1024, 91);
  http = createServer((_request, response) => {
   response.writeHead(200, { "Content-Length": payload.length * 100 });
   let chunks = 0;
   const timer = setInterval(() => { response.write(payload); if (++chunks === 100) { clearInterval(timer); response.end(); } }, 80);
   response.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => http!.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}/direct.bin`;
  await prisma.sshKey.create({ data: { id: prefix, name: prefix, fingerprint: prefix, publicKey: "fixture", privateKey: server.sshKey!.privateKey } });
  await prisma.server.create({ data: { id: prefix, name: prefix, host: server.host, port: server.port, username: server.username, connectionType: "SSH_KEY", sshKeyId: prefix, hostKeySha256: server.hostKeySha256 } });
  await prisma.downloadTask.create({ data: { id: prefix, url, serverId: prefix, targetPath: directory, fileName: "direct.bin" } });
  await writeFile(path.join(directory, "direct.bin"), "old-direct-file");
  const direct = child("direct-child", [prefix, url, directory]); activeChild = direct.process;
  assert.equal((await direct.result).signal, "SIGKILL"); activeChild = undefined;
  const task = await prisma.downloadTask.findUniqueOrThrow({ where: { id: prefix } });
  assert.equal(task.status, "RUNNING"); assert.equal(task.pid, null);
  assert.equal(await readFile(path.join(directory, "direct.bin"), "utf8"), "old-direct-file");
  await prisma.downloadTask.update({ where: { id: prefix }, data: { updatedAt: new Date(0) } });
  assert.equal((await reconcileStaleRunningDownloadTasks({ taskIds: [prefix] })).failed, 0);
  const exitFile = `/tmp/app-dl-${prefix}.pid.exit`;
  await until(async () => { try { return (await readFile(exitFile, "utf8")).trim() === "0"; } catch { return false; } });
  const result = await reconcileStaleRunningDownloadTasks({ taskIds: [prefix] });
  assert.equal(result.completed, 1);
  const expected = createHash("sha256"); for (let index = 0; index < 100; index++) expected.update(payload);
  assert.equal(await hashTransferFile(path.join(directory, "direct.bin")), expected.digest("hex"));
  assert.equal((await reconcileStaleRunningDownloadTasks({ taskIds: [prefix] })).completed, 0);
  checks.push("SIGKILL before PID persistence recovers through remote markers exactly once");
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  if (process.env.RECOVERY_OUTPUT) await writeFile(process.env.RECOVERY_OUTPUT, JSON.stringify({ passed: checks.length, checks }, null, 2));
 } finally {
  activeChild?.kill("SIGKILL");
  if (http) { http.closeAllConnections(); await new Promise<void>((resolve) => http!.close(() => resolve())); }
  await prisma.downloadTask.deleteMany({ where: { id: prefix } });
  await prisma.server.deleteMany({ where: { id: prefix } });
  await prisma.sshKey.deleteMany({ where: { id: prefix } });
  await closeSshPool(); await prisma.$disconnect();
  await rm(directory, { recursive: true, force: true });
  for (const suffix of ["pid", "pid.exit", "pid.exit.tmp", "log"]) await rm(`/tmp/app-dl-${prefix}.${suffix}`, { force: true });
 }
}
main().catch((error) => { console.error(error); process.exit(1); });
