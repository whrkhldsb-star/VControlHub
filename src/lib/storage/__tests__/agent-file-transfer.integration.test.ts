// @vitest-environment node
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:https";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth/session";
import { initMediaUploadSession, appendMediaUploadChunk, cleanupMediaUploadTempDir } from "@/lib/upload/service";
import { createApiToken } from "@/lib/api-token/service";
import { GET as download } from "@/app/api/storage/webdav-download/route";
import { POST } from "@/app/api/agent/v1/files/route";
import { createStorageNode } from "../service-nodes";
import { pairFileShare } from "../agent-file-queue";
import { completeStorageFileUpload } from "../resumable-upload";
import { createAgentFileClient } from "../agent-file-client";

import { checkDriveWorkflows, checkDriveOwnership } from "./agent-drive-workflows";

vi.mock("undici", async importOriginal => {
  const original = await importOriginal<typeof import("undici")>();
  return { ...original, request: vi.fn(original.request) };
});
const binary = process.env.VCH_TEST_FILE_AGENT;
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1" || !binary)(
  "native outbound file Agent",
  () => {
    const id = `files-${randomUUID()}`;
    const actor: SessionPayload = {
      userId: id,
      username: id,
      roles: ["admin"],
      permissions: ["storage:manage-node", "storage:write", "storage:read"],
      currentTeamId: id,
      mustChangePassword: false,
    };
    let apiToken: string;
    let dir: string, nodeId: string, hub: string, token: string, sessionId: string;
    let http: Server, agent: ChildProcess | undefined;
    let disconnectAfterChunk = false;
    const operations = new Map<string, string>();
    const resumeOffsets: number[] = [];
    async function start(writable: boolean) {
      await writeFile(
        join(dir, "config.json"),
        JSON.stringify({ hub, token, root: join(dir, "shared"), writable }),
        { mode: 0o600 },
      );
      agent = spawn(binary!, ["-config", join(dir, "config.json")], {
        env: { ...process.env, SSL_CERT_FILE: join(dir, "cert.pem") },
        stdio: "ignore",
      });
      let connected = false;
      for (let i = 0; i < 100; i++) {
        const share = await prisma.agentFileShare.findUniqueOrThrow({ where: { storageNodeId: nodeId } });
        if (share.seenAt && share.writable === writable) {
          connected = true;
          break;
        }
        if (agent.exitCode !== null) throw new Error("file Agent exited before pairing");
        await delay(100);
      }
      expect(connected).toBe(true);
    }
    beforeAll(async () => {
      const database = new URL(process.env.DATABASE_URL!);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || !/test|_ci/.test(database.pathname))
        throw new Error("requires isolated test PostgreSQL");
      dir = await mkdtemp(join(tmpdir(), "vch-agent-files-"));
      await mkdir(join(dir, "shared"));
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "1",
          "-subj",
          "/CN=localhost",
          "-addext",
          "subjectAltName=IP:127.0.0.1",
          "-keyout",
          join(dir, "key.pem"),
          "-out",
          join(dir, "cert.pem"),
        ],
        { stdio: "ignore" },
      );
      await prisma.team.create({ data: { id, slug: id, name: id } });
      await prisma.identityTemplate.create({ data: { id, name: id, permissions: ["storage:read", "storage:write"] } });
      await prisma.user.create({
        data: {
          id,
          username: id,
          passwordHash: "not-a-login",
          mustChangePassword: false,
          currentTeamId: id,
          teamMembership: { create: { teamId: id, identityTemplateId: id } },
        },
      });
      apiToken = (
        await createApiToken({ userId: id, teamId: id, name: "download fixture", scopes: ["storage:read", "storage:write"] })
      ).token;
      await prisma.server.create({
        data: {
          id,
          name: id,
          teamId: id,
          tags: [],
          host: "node.invalid",
          username: "operator",
          managementMode: "AGENT",
          agentTokenHash: "management-identity",
        },
      });
      const node = await createStorageNode(
        {
          name: id,
          driver: "AGENT",
          basePath: "/",
          serverId: id,
          directAccessMode: "PROXY",
          isDefault: false,
          directAccessExpiresSeconds: 300,
        },
        actor,
      );
      nodeId = node.id;
      token = await pairFileShare(nodeId, actor);
      http = createServer(
        { key: await readFile(join(dir, "key.pem")), cert: await readFile(join(dir, "cert.pem")) },
        async (req, res) => {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = Buffer.concat(chunks).toString("utf8");
            const response = await POST(
              new Request(hub + "/api/agent/v1/files", {
                method: "POST",
                body,
                headers: { authorization: req.headers.authorization ?? "" },
              }),
            );
            const raw = await response.text();
            const previous = JSON.parse(body).receipt;
            const previousOp = previous && operations.get(previous.id);
            if (previousOp === "begin") resumeOffsets.push(previous.result.offset);
            if (response.ok) {
              const { job } = JSON.parse(raw);
              if (job) operations.set(job.id, job.operation.op);
            }
            if (disconnectAfterChunk && previousOp === "chunk") {
              disconnectAfterChunk = false;
              agent?.kill("SIGKILL");
            }
            res.writeHead(response.status, { "Content-Type": "application/json" });
            res.end(raw);
          } catch {
            res.writeHead(500);
            res.end();
          }
        },
      );
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      hub = `https://127.0.0.1:${(http.address() as { port: number }).port}`;
    }, 30_000);
    afterAll(async () => {
      agent?.kill();
      http?.closeAllConnections();
      if (http) await new Promise<void>((resolve) => http.close(() => resolve()));
      if (sessionId) await cleanupMediaUploadTempDir(sessionId);
      if (nodeId) await prisma.storageNode.deleteMany({ where: { id: nodeId } });
      await prisma.server.deleteMany({ where: { id } });
      await prisma.user.deleteMany({ where: { id } });
      await prisma.team.deleteMany({ where: { id } });
      await prisma.identityTemplate.deleteMany({ where: { id } });
      if (dir) await rm(dir, { recursive: true, force: true });
    });
    it("resumes a website upload after the Agent process dies, checks the bytes, and revokes the old drive on a mode switch", async () => {
      await start(true);
      // The same file credential cannot silently move an existing drive to another directory.
      const mismatched = await POST(
        new Request(hub + "/api/agent/v1/files", {
          method: "POST",
          headers: { authorization: "Bearer " + token },
          body: JSON.stringify({ writable: true, rootIdentity: "0".repeat(64) }),
        }),
      );
      expect(mismatched.status).toBe(401);
      const name = "db  backup.bin";
      const data = randomBytes(8 * 1024 * 1024 + 29),
        chunkSize = 1024 * 1024;
      const upload = await initMediaUploadSession({
        userId: id,
        filename: name,
        mimeType: "application/octet-stream",
        totalSize: data.length,
        chunkSize,
        storageNodeId: nodeId,
        relativePath: name,
        session: actor,
      });
      sessionId = upload.id;
      for (let at = 0; at < data.length; at += chunkSize) {
        const buffer = data.subarray(at, at + chunkSize);
        await appendMediaUploadChunk({
          sessionId,
          userId: id,
          index: at / chunkSize,
          size: buffer.length,
          buffer,
        });
      }
      disconnectAfterChunk = true;
      await expect(completeStorageFileUpload({ sessionId, session: actor })).rejects.toThrow();
      expect(await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({
        status: "UPLOADING",
        recoveryRequired: false,
      });
      await expect(readFile(join(dir, "shared", name))).rejects.toMatchObject({ code: "ENOENT" });
      await start(true);
      await completeStorageFileUpload({ sessionId, session: actor });
      expect(resumeOffsets).toContain(chunkSize);
      const actual = await readFile(join(dir, "shared", name));
      const expectedDigest = createHash("sha256").update(data).digest("hex");
      expect(createHash("sha256").update(actual).digest("hex")).toBe(expectedDigest);
      const client = createAgentFileClient(nodeId);
      expect((await client.list()).map((entry) => entry.name)).toEqual([name]);
      const url = hub + "/api/storage/webdav-download?" + new URLSearchParams({ nodeId, path: name });
      const requestDownload = (range?: string) =>
        download(
          new Request(url, { headers: { authorization: "Bearer " + apiToken, ...(range ? { range } : {}) } }),
        );
      const whole = await requestDownload();
      expect(whole.status).toBe(200);
      const all = await whole.arrayBuffer();
      expect(createHash("sha256").update(Buffer.from(all)).digest("hex")).toBe(expectedDigest);
      const partial = await requestDownload(`bytes=${chunkSize - 10}-${chunkSize + 12}`);
      expect(partial.status).toBe(206);
      const range = await partial.arrayBuffer();
      expect(Buffer.from(range)).toEqual(data.subarray(chunkSize - 10, chunkSize + 13));
      await checkDriveWorkflows({ actor, serverId: id, nodeId, root: join(dir, "shared"), hub, apiToken, uploaded: name });
      await prisma.userStorageAccess.create({
        data: { userId: id, storageNodeId: nodeId, pathPrefix: "restricted", canRead: true },
      });
      expect((await requestDownload()).status).toBe(403);
      const observation = await prisma.agentFileShare.findUniqueOrThrow({ where: { storageNodeId: nodeId } });
      expect(observation.lastReadAt).toBeInstanceOf(Date);
      expect(observation.lastWriteAt).toBeInstanceOf(Date);
      agent?.kill();
      await start(false);
      await expect(client.write("disabled.txt", "test")).rejects.toThrow();
      await prisma.server.update({ where: { id }, data: { managementMode: "DIRECT", agentTokenHash: null } });
      const poll = () =>
        POST(
          new Request(hub + "/api/agent/v1/files", {
            method: "POST",
            headers: { authorization: "Bearer " + token },
            body: JSON.stringify({ writable: false, rootIdentity: "0".repeat(64) }),
          }),
        );
      expect((await poll()).status).toBe(401);
      await prisma.server.update({
        where: { id },
        data: { managementMode: "AGENT", agentTokenHash: "new-identity" },
      });
      expect((await poll()).status).toBe(401);
      await checkDriveOwnership(actor, id, nodeId);
    }, 240_000);
  },
);
