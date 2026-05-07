import { mkdir, mkdtemp, rm, writeFile as writeFileToDisk } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
 mockPrisma: {
 storageNode: {
 updateMany: vi.fn(),
 create: vi.fn(),
 findMany: vi.fn(),
 update: vi.fn(),
 },
 fileEntry: {
 create: vi.fn(),
 findMany: vi.fn(),
 findUnique: vi.fn(),
 findFirst: vi.fn(),
 update: vi.fn(),
 },
 },
}));

vi.mock("@/lib/db", () => ({
 prisma: mockPrisma,
 isDatabaseUnavailableError: vi.fn(() => false),
}));
import {
	createFileEntry,
	createStorageNode,
	getLocalEditableFileDraft,
	getStorageOverview,
	listFileEntries,
} from "@/lib/storage/service";
import { prisma } from "@/lib/db";

describe("storage service", () => {
 it("creates a local default storage node", async () => {
 vi.clearAllMocks();
 vi.mocked(prisma.storageNode.updateMany).mockResolvedValue({ count: 0 });
 vi.mocked(prisma.storageNode.create).mockResolvedValueOnce({
 id: "node_1",
 name: "主控本机",
 driver: "LOCAL",
 isDefault: true,
 basePath: "/srv/whrkhldsb/storage",
 host: null,
 port: null,
 username: null,
 serverId: null,
 server: null,
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any);

 const result = await createStorageNode({
 name: "主控本机",
 driver: "LOCAL",
 basePath: "/srv/whrkhldsb/storage",
 isDefault: true,
 });

 expect(prisma.storageNode.updateMany).toHaveBeenCalledWith({ where: {}, data: { isDefault: false } });
 expect(result.connectionSummary).toContain("本机存储");
 expect(result.directAccess.mode).toBe("managed-download");
 });

 it("creates an sftp node with managed-download strategy", async () => {
 vi.clearAllMocks();
 vi.mocked(prisma.storageNode.create).mockResolvedValueOnce({
 id: "node_2",
 name: "香港媒体库",
 driver: "SFTP",
 isDefault: false,
 basePath: "/data/media",
 host: "203.0.113.11",
 port: 22,
 username: "root",
 serverId: "srv_1",
 server: {
 id: "srv_1",
 name: "hk-media-1",
 host: "203.0.113.11",
 port: 22,
 username: "root",
 },
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any);

 const result = await createStorageNode({
 name: "香港媒体库",
 driver: "SFTP",
 basePath: "/data/media",
 isDefault: false,
 host: "203.0.113.11",
 port: 22,
 username: "root",
 serverId: "srv_1",
 });

 expect(result.connectionSummary).toContain("SFTP 存储");
 expect(result.directAccess.mode).toBe("managed-download");
 });

 it("lists file entries with preview flags and direct access strategy", async () => {
 vi.clearAllMocks();
 vi.mocked(prisma.fileEntry.findMany).mockResolvedValueOnce([
 {
 id: "file_1",
 name: "demo.mp4",
 entryType: "FILE",
 mimeType: "video/mp4",
 size: BigInt(1024),
 checksumSha256: null,
 relativePath: "videos/demo.mp4",
 storageNodeId: "node_2",
 parentId: null,
 isDeleted: false,
 createdAt: new Date(),
 updatedAt: new Date(),
 storageNode: {
 id: "node_2",
 name: "香港媒体库",
 driver: "SFTP",
 basePath: "/data/media",
 host: "203.0.113.11",
 port: 22,
 username: "root",
 server: {
 id: "srv_1",
 name: "hk-media-1",
 host: "203.0.113.11",
 port: 22,
 },
 },
 } as any,
 ]);

 const result = await listFileEntries();

 expect(result[0]?.previewable).toBe(true);
 expect(result[0]?.directAccess.mode).toBe("managed-download");
 expect(result[0]?.sizeLabel).toBe("1.0 KB");
 });

 it("builds storage overview stats", async () => {
 vi.clearAllMocks();
 vi.mocked(prisma.storageNode.findMany).mockResolvedValueOnce([
 {
 id: "node_1",
 name: "主控本机",
 driver: "LOCAL",
 isDefault: true,
 basePath: "/srv/whrkhldsb/storage",
 host: null,
 port: null,
 username: null,
 serverId: null,
 server: null,
 fileEntries: [{ id: "f_1" }],
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any,
 ]);
 vi.mocked(prisma.fileEntry.findMany)
 .mockResolvedValueOnce([
 {
 id: "dir_1",
 name: "archives",
 entryType: "DIRECTORY",
 mimeType: "inode/directory",
 size: null,
 checksumSha256: null,
 relativePath: "archives",
 storageNodeId: "node_1",
 parentId: null,
 isDeleted: false,
 createdAt: new Date(),
 updatedAt: new Date(),
 storageNode: {
 id: "node_1",
 name: "主控本机",
 driver: "LOCAL",
 basePath: "/srv/whrkhldsb/storage",
 host: null,
 port: null,
 username: null,
 server: null,
 },
 } as any,
 {
 id: "file_1",
 name: "cover.jpg",
 entryType: "FILE",
 mimeType: "image/jpeg",
 size: BigInt(128),
 checksumSha256: null,
 relativePath: "archives/2026/cover.jpg",
 storageNodeId: "node_1",
 parentId: null,
 isDeleted: false,
 createdAt: new Date(),
 updatedAt: new Date(),
 storageNode: {
 id: "node_1",
 name: "主控本机",
 driver: "LOCAL",
 basePath: "/srv/whrkhldsb/storage",
 host: null,
 port: null,
 username: null,
 server: null,
 },
 } as any,
 ])
 .mockResolvedValueOnce([]);

 const result = await getStorageOverview();

 expect(result.stats.totalNodes).toBe(1);
 expect(result.stats.defaultNodeName).toBe("主控本机");
 expect(result.stats.previewableEntries).toBe(1);
 expect(result.remoteDirectories.map((directory: any) => directory.path)).toEqual(["archives", "archives/2026"]);
 expect(result.stats.remoteDirectoryCount).toBe(2);
 });

 it("creates file metadata entries", async () => {
 vi.clearAllMocks();
 vi.mocked(prisma.fileEntry.findFirst).mockResolvedValueOnce(null);
 vi.mocked(prisma.fileEntry.create).mockResolvedValueOnce({
 id: "file_2",
 name: "notes.txt",
 entryType: "FILE",
 mimeType: "text/plain",
 size: BigInt(12),
 checksumSha256: null,
 relativePath: "docs/notes.txt",
 storageNodeId: "node_1",
 parentId: null,
 isDeleted: false,
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any);

 const result = await createFileEntry({
 storageNodeId: "node_1",
 name: "notes.txt",
 entryType: "FILE",
 mimeType: "text/plain",
 size: 12,
 relativePath: "docs/notes.txt",
 });

 expect(result.name).toBe("notes.txt");
 expect(prisma.fileEntry.create).toHaveBeenCalled();
 });

 it("loads editable local file drafts from local storage", async () => {
 vi.clearAllMocks();
 const tempRoot = await mkdtemp(path.join(tmpdir(), "storage-editable-"));
 const relativePath = "docs/notes.txt";
 const absolutePath = path.join(tempRoot, relativePath);
 await mkdir(path.dirname(absolutePath), { recursive: true });
 await writeFileToDisk(absolutePath, "hello world", "utf8");

 vi.mocked(prisma.fileEntry.findUnique).mockResolvedValueOnce({
 id: "file_3",
 name: "notes.txt",
 entryType: "FILE",
 mimeType: "text/plain",
 size: BigInt(12),
 checksumSha256: null,
 relativePath,
 storageNodeId: "node_1",
 parentId: null,
 isDeleted: false,
 createdAt: new Date(),
 updatedAt: new Date("2026-04-20T01:02:03.000Z"),
 storageNode: {
 id: "node_1",
 name: "主控本机",
 driver: "LOCAL",
 basePath: tempRoot,
 },
 } as any);

 try {
 const result = await getLocalEditableFileDraft("file_3");

 expect(result).toMatchObject({
 fileEntryId: "file_3",
 name: "notes.txt",
 relativePath,
 content: "hello world",
 byteSize: 11,
 });
 } finally {
 await rm(tempRoot, { recursive: true, force: true });
 }
});
});
