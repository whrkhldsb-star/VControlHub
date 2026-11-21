// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ directory: "", remote: vi.fn(), forget: vi.fn(), agentMatches: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/runtime/platform-paths", async original => ({
  ...await original<typeof import("@/lib/runtime/platform-paths")>(), relayTempDir: (id: string) => join(io.directory, id),
}));
vi.mock("@/lib/storage/agent-file-client", () => ({ createAgentFileClient: () => ({ matches: io.agentMatches }) }));
vi.mock("@/lib/notification/service", () => ({ notifyDownloadResult: io.notify }));
vi.mock("@/lib/downloads/execution", async original => ({
  ...await original<typeof import("@/lib/downloads/execution")>(), resolveBoundDownloadEndpoint: () => ({ hostKeySha256: "pin" }),
}));
vi.mock("@/lib/aria2/service", async original => ({ ...await original<typeof import("@/lib/aria2/service")>(), forgetDownload: io.forget }));
vi.mock("@/lib/ssh/client", async original => ({ ...await original<typeof import("@/lib/ssh/client")>(), execRemoteCommand: io.remote }));
vi.mock("@/lib/storage/remote-containment", () => ({ assertRemotePathContained: (_ssh: unknown, _base: string, target: string) => target }));

import { prisma } from "@/lib/db";
import { receiveAgentHttpDownload } from "../agent-relay";
import { reconcileTerminalRelay } from "../relay-cleanup";
import { downloadHistoryRemovable } from "../transfer-manifest";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("terminal relay receipts", () => {
  const id = "relay-" + randomUUID();
  const agentNode = id + "-agent";
  const metadataGid = "0000000000000002";
  const sha256 = "a".repeat(64);
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("requires isolated test database");
    io.directory = await mkdtemp(join(tmpdir(), "receipt-"));
    await mkdir(join(io.directory, id));
    await writeFile(join(io.directory, id, "staged"), "data");
    await prisma.user.create({ data: { id, username: id, passwordHash: "unused" } });
    await prisma.server.create({ data: { id, name: id, host: "fixture.invalid", username: "test" } });
    await prisma.storageNode.create({ data: { id, name: id, driver: "SFTP", serverId: id, basePath: "/drive" } });
    await prisma.downloadTask.create({ data: { id, url: "magnet:?dn=fixture", status: "FAILED", aria2Gid: "0000000000000001", serverId: id,
      directStorageNodeId: id, relayMode: true, targetPath: "/drive/test", transferManifest: { version: 1, metadataGid, files: [
        { name: "published", size: 4, sha256 }, { name: "absent", size: 4, sha256 },
      ] } } });
  });
  afterAll(async () => {
    await prisma.storageNode.deleteMany({ where: { id: { in: [id, agentNode] } } });
    await prisma.server.deleteMany({ where: { id } });
    await prisma.user.deleteMany({ where: { id } });
    if (io.directory) await rm(io.directory, { recursive: true, force: true });
    await prisma.$disconnect();
  });
  it("indexes only verified published bytes and keeps history until resource reclamation succeeds", async () => {
    const purge = () => prisma.downloadTask.deleteMany({ where: { id, ...downloadHistoryRemovable } });
    expect(await purge()).toEqual({ count: 0 });
    io.remote.mockImplementation(async ({ command }: { command: string }) => ({
      exitCode: 0, stdout: command.includes("f='/drive/test/published'") ? sha256 + "  -" : "ABSENT",
    }));
    io.forget.mockRejectedValueOnce(new Error("daemon offline")).mockResolvedValue(undefined);
    await expect(reconcileTerminalRelay(id)).rejects.toThrow("daemon offline");
    expect((await stat(join(io.directory, id))).isDirectory()).toBe(true);
    expect(await purge()).toEqual({ count: 0 });
    expect(await reconcileTerminalRelay(id)).toBe(true);
    expect(await reconcileTerminalRelay(id)).toBe(true);
    expect(io.remote.mock.calls.every(([call]) => call.command.includes(".part") && call.command.includes("-delete"))).toBe(true);
    expect(await prisma.fileEntry.findMany({ where: { storageNodeId: id }, select: { relativePath: true, size: true } }))
      .toEqual([{ relativePath: "test/published", size: BigInt(4) }]);
    await expect(stat(join(io.directory, id))).rejects.toMatchObject({ code: "ENOENT" });
    expect(io.forget.mock.calls.map(([gid]) => gid)).toEqual(["0000000000000001", "0000000000000001", metadataGid]);
    expect(await purge()).toEqual({ count: 1 });
  });

  it("repairs only matching files on the original Agent root after a failed publication", async () => {
    const root = "v2:" + "b".repeat(64);
    await prisma.storageNode.create({ data: { id: agentNode, name: agentNode, driver: "AGENT", basePath: "/" } });
    await prisma.agentFileShare.create({ data: { storageNodeId: agentNode, serverId: id, rootIdentity: root } });
    const task = await prisma.downloadTask.create({ data: {
      url: "https://fixture.invalid/files", status: "FAILED", serverId: id, targetPath: "/test",
      agentStorageNodeId: agentNode, agentRootIdentity: root, transferManifest: { version: 1, agentRootIdentity: root,
        files: [{ name: "matching", size: 4, sha256 }, { name: "changed", size: 4, sha256 }] },
    } });
    io.agentMatches.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await reconcileTerminalRelay(task.id)).toBe(true);
    expect(io.agentMatches.mock.calls).toEqual([["test/matching", 4, sha256], ["test/changed", 4, sha256]]);
    expect(await prisma.fileEntry.findMany({ where: { storageNodeId: agentNode }, select: { relativePath: true } }))
      .toEqual([{ relativePath: "test/matching" }]);
  });

  it("uses only the source origin in both successful and failed HTTP relay notifications", async () => {
    const url = "https://fixture.invalid/private/file?signature=sensitive";
    const digest = createHash("sha256").update("data").digest("hex");
    io.notify.mockResolvedValue(undefined);
    const task = await prisma.downloadTask.create({ data: {
      url, serverId: id, createdBy: id, targetPath: "/drive", relayMode: true,
      transferManifest: { version: 1, files: [{ name: "file", size: 4, sha256: digest }] },
    } });
    await mkdir(join(io.directory, task.id));
    await writeFile(join(io.directory, task.id, digest), "data");
    const input = { taskId: task.id, serverId: id, nodeId: id, url, targetPath: "/drive" };
    await receiveAgentHttpDownload({ ...input, publishSftp: vi.fn() });
    expect(io.notify).toHaveBeenCalledWith(id, "https://fixture.invalid", "completed", undefined, null);

    const failed = await prisma.downloadTask.create({ data: { url, serverId: id, agentStorageNodeId: agentNode, createdBy: id, targetPath: "/" } });
    await receiveAgentHttpDownload({ ...input, taskId: failed.id, nodeId: agentNode });
    expect(io.notify).toHaveBeenCalledWith(id, "https://fixture.invalid", "failed", expect.any(String), null);
  });
});
