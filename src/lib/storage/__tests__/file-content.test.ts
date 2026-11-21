import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

const { agentCommand, sftpLstatMock, sftpReadFileMock, sftpWriteFileMock, sftpUnlinkMock, connectMock, sftpStatMock, sftpMkdirMock } = vi.hoisted(() => {
	const sftpReadFileMock = vi.fn();
	const sftpWriteFileMock = vi.fn();
	const sftpUnlinkMock = vi.fn();
	const sftpStatMock = vi.fn((remotePath: string, callback: (error?: Error | null) => void) => {
		callback(remotePath === "/srv" ? null : new Error("missing"));
	});
	const sftpMkdirMock = vi.fn((_remotePath: string, callback: (error?: Error | null) => void) => callback(null));
	const connectMock = vi.fn();
	return { agentCommand: vi.fn(), sftpLstatMock: vi.fn(), sftpReadFileMock, sftpWriteFileMock, sftpUnlinkMock, connectMock, sftpStatMock, sftpMkdirMock };
});

vi.mock("@/lib/server/agent-service", () => ({ executeCommandWithAgent: agentCommand }));

// No symlinks on the mocked host: physical path == lexical path.
vi.mock("@/lib/ssh/client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/ssh/client")>()),
	resolveRemoteRealPath: vi.fn(async ({ remotePath }: { remotePath: string }) => remotePath),
}));
vi.mock("ssh2", async () => {
	const { EventEmitter } = await import("node:events");
	return { Client: class MockClient extends EventEmitter {
		connect(config: unknown) {
			connectMock(config);
			queueMicrotask(() => this.emit("ready"));
		}
		sftp(callback: (error: Error | null, sftp?: unknown) => void) {
			callback(null, {
				readFile: sftpReadFileMock,
				writeFile: sftpWriteFileMock,
				unlink: sftpUnlinkMock,
				stat: sftpStatMock,
				lstat: sftpLstatMock,
				mkdir: sftpMkdirMock,
				end() {},
			});
		}
		end() { this.emit("close"); }
	} };
});

import { closeSshPool } from "@/lib/ssh/client";
import { createManagedFolder, statBackingObject } from "../fs-backend";
import {
	buildStorageFileDownloadUrl,
	deleteStorageFileBuffer,
	readStorageFileBuffer,
	writeStorageFileBuffer,
	type StorageFileNode,
} from "../file-content";

let tempRoot: string | null = null;

afterEach(async () => {
	await closeSshPool();
	if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
	tempRoot = null;
	vi.clearAllMocks();
});

function localNode(basePath: string): StorageFileNode {
	return { id: "local_1", driver: "LOCAL", basePath, host: null, port: null, username: null, hostKeySha256: null, server: null };
}

function sftpNode(): StorageFileNode {
	return {
		teamId: null,
		id: "sftp_1",
		driver: "SFTP",
		basePath: "/srv/media",
		serverId: "server_1",
		server: {
			teamId: null,
			id: "server_1",
			host: "127.0.0.1",
			port: 22,
			username: "root",
			connectionType: "PASSWORD",
			password: "secret",
			sshKey: null,
			managementMode: "DIRECT",
			operatingSystem: "LINUX",
			hostKeySha256: "SHA256:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
		},
		host: null,
		port: null,
		username: null,
		hostKeySha256: null,
	};
}

describe("storage file content helpers", () => {
	it("reads and writes LOCAL files through the storage base path guard", async () => {
		tempRoot = await mkdtemp(path.join(tmpdir(), "vcontrolhub-storage-file-content-"));
		await writeStorageFileBuffer(localNode(tempRoot), "gallery/photo.png", Buffer.from("png"));

		await expect(readFile(path.join(tempRoot, "gallery/photo.png"))).resolves.toEqual(Buffer.from("png"));
		await expect(readStorageFileBuffer(localNode(tempRoot), "gallery/photo.png")).resolves.toEqual(Buffer.from("png"));
	});

	it("rejects LOCAL traversal attempts before touching filesystem", async () => {
		tempRoot = await mkdtemp(path.join(tmpdir(), "vcontrolhub-storage-file-content-"));
		await expect(writeStorageFileBuffer(localNode(tempRoot), "../escape.png", Buffer.from("x"))).rejects.toThrow(/非法|越界|path|路径/i);
		await expect(readStorageFileBuffer(localNode(tempRoot), "../escape.png")).rejects.toThrow(/非法|越界|path|路径/i);
	});

	it("reads and writes SFTP files through resolved server credentials", async () => {
		sftpReadFileMock.mockImplementation((_remotePath: string, callback: (error: Error | null, data?: Buffer) => void) => callback(null, Buffer.from("remote")));
		sftpWriteFileMock.mockImplementation((_remotePath: string, _buffer: Buffer, callback: (error?: Error | null) => void) => callback(null));

		await expect(readStorageFileBuffer(sftpNode(), "gallery/source.png")).resolves.toEqual(Buffer.from("remote"));
		await expect(writeStorageFileBuffer(sftpNode(), "gallery/upload.png", Buffer.from("upload"))).resolves.toBe("/srv/media/gallery/upload.png");

		expect(connectMock).toHaveBeenCalledWith(expect.objectContaining({ host: "127.0.0.1", username: "root", password: "secret", hostVerifier: expect.any(Function) }));
		expect(sftpReadFileMock).toHaveBeenCalledWith("/srv/media/gallery/source.png", expect.any(Function));
		expect(sftpWriteFileMock).toHaveBeenCalledWith("/srv/media/gallery/upload.png", Buffer.from("upload"), expect.any(Function));
	});

	it("treats only an SFTP missing-file status as an empty path", async () => {
		const options = { storageNode: sftpNode(), relativePath: "not found.txt" };
		for (const code of [3, 4]) {
			const denied = Object.assign(new Error("Permission denied: not found.txt"), { code });
			sftpLstatMock.mockImplementationOnce((_path, callback) => callback(denied));
			await expect(statBackingObject(options)).rejects.toBe(denied);
		}
		sftpLstatMock.mockImplementationOnce((_path, callback) => callback(Object.assign(new Error("missing"), { code: 2 })));
		await expect(statBackingObject(options)).resolves.toBeNull();
	});

	it("reads explicit missing-file and existing-directory results from an Agent-only SFTP node", async () => {
		const node = sftpNode();
		node.server = { ...node.server!, managementMode: "AGENT", password: null };
		const options = { storageNode: node, relativePath: "not found.txt" };
		agentCommand.mockResolvedValueOnce({ exitCode: 1, stderr: "Permission denied: not found.txt" });
		await expect(statBackingObject(options)).rejects.toThrow("Permission denied");
		agentCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "null\n" });
		await expect(statBackingObject(options)).resolves.toBeNull();
		agentCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "existing-directory\n" });
		await expect(createManagedFolder({ ...options, allowExisting: true })).resolves.toEqual({ created: false });
	});

	it("distinguishes an exclusive SFTP mkdir from adopting an existing directory", async () => {
		const node = sftpNode();
		const options = { storageNode: node, relativePath: "gallery" };
		await expect(createManagedFolder(options)).resolves.toEqual({ created: true });
		const exists = Object.assign(new Error("Failure"), { code: 4 });
		for (const allowExisting of [false, true]) {
			sftpMkdirMock.mockImplementationOnce((_path, callback) => callback(exists));
			sftpStatMock.mockImplementationOnce((_path: string, callback: (error?: Error | null, stats?: { isDirectory(): boolean }) => void) =>
				callback(null, { isDirectory: () => true }),
			);
			const result = createManagedFolder({ ...options, allowExisting });
			if (allowExisting) await expect(result).resolves.toEqual({ created: false });
			else await expect(result).rejects.toMatchObject({ code: "EEXIST" });
		}
	});

	it("rejects generic SFTP Failure errors unless a follow-up stat confirms the directory", async () => {
		sftpMkdirMock.mockImplementationOnce((_remotePath: string, callback: (error?: Error | null) => void) => callback(new Error("Failure")));
		sftpStatMock.mockImplementation((remotePath: string, callback: (error?: Error | null, stats?: { isDirectory(): boolean }) => void) => {
			if (remotePath === "/srv") return callback(null, { isDirectory: () => true });
			callback(new Error("still missing"));
		});

		await expect(writeStorageFileBuffer(sftpNode(), "gallery/upload.png", Buffer.from("upload"))).rejects.toThrow("Failure");
		expect(sftpWriteFileMock).not.toHaveBeenCalled();
	});

	it("builds node-appropriate download URLs for media source links", () => {
		expect(buildStorageFileDownloadUrl({ id: "local_1", driver: "LOCAL" }, "gallery/a b.png", true)).toBe("/api/storage/local?nodeId=local_1&path=gallery%2Fa+b.png&download=1");
		expect(buildStorageFileDownloadUrl({ id: "sftp_1", driver: "SFTP" }, "/gallery/a.png", false)).toBe("/api/storage/sftp-download?nodeId=sftp_1&path=gallery%2Fa.png");
	});

	it("deletes LOCAL and SFTP files for compensating rollback", async () => {
		tempRoot = await mkdtemp(path.join(tmpdir(), "vcontrolhub-storage-file-content-"));
		await writeStorageFileBuffer(localNode(tempRoot), "gallery/orphan.png", Buffer.from("png"));
		await expect(deleteStorageFileBuffer(localNode(tempRoot), "gallery/orphan.png")).resolves.toBe(
			path.join(tempRoot, "gallery/orphan.png"),
		);
		await expect(readFile(path.join(tempRoot, "gallery/orphan.png"))).rejects.toThrow();

		sftpUnlinkMock.mockImplementation((_remotePath: string, callback: (error?: Error | null) => void) =>
			callback(null),
		);
		await expect(deleteStorageFileBuffer(sftpNode(), "gallery/upload.png")).resolves.toBe(
			"/srv/media/gallery/upload.png",
		);
		expect(sftpUnlinkMock).toHaveBeenCalledWith("/srv/media/gallery/upload.png", expect.any(Function));
	});
});
