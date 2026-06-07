import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

const { sftpReadFileMock, sftpWriteFileMock, connectMock, sftpStatMock, sftpMkdirMock } = vi.hoisted(() => {
	const sftpReadFileMock = vi.fn();
	const sftpWriteFileMock = vi.fn();
	const sftpStatMock = vi.fn((remotePath: string, callback: (error?: Error | null) => void) => {
		callback(remotePath === "/srv" ? null : new Error("missing"));
	});
	const sftpMkdirMock = vi.fn((_remotePath: string, callback: (error?: Error | null) => void) => callback(null));
	const connectMock = vi.fn();
	return { sftpReadFileMock, sftpWriteFileMock, connectMock, sftpStatMock, sftpMkdirMock };
});

vi.mock("ssh2", () => ({
	Client: class MockClient {
		on(event: string, callback: (...args: unknown[]) => void) {
			if (event === "ready") setTimeout(callback, 0);
			return this;
		}
		connect(config: unknown) {
			connectMock(config);
		}
		sftp(callback: (error: Error | null, sftp?: unknown) => void) {
			callback(null, {
				readFile: sftpReadFileMock,
				writeFile: sftpWriteFileMock,
				stat: sftpStatMock,
				mkdir: sftpMkdirMock,
			});
		}
		end() {}
	},
}));

import {
	buildStorageFileDownloadUrl,
	readStorageFileBuffer,
	writeStorageFileBuffer,
	type StorageFileNode,
} from "../file-content";

let tempRoot: string | null = null;

afterEach(async () => {
	if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
	tempRoot = null;
	vi.clearAllMocks();
});

function localNode(basePath: string): StorageFileNode {
	return { id: "local_1", driver: "LOCAL", basePath };
}

function sftpNode(): StorageFileNode {
	return {
		id: "sftp_1",
		driver: "SFTP",
		basePath: "/srv/media",
		serverId: "server_1",
		server: {
			id: "server_1",
			host: "127.0.0.1",
			port: 22,
			username: "root",
			connectionType: "PASSWORD",
			password: "secret",
			sshKey: null,
		},
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

		expect(connectMock).toHaveBeenCalledWith(expect.objectContaining({ host: "127.0.0.1", username: "root", password: "secret" }));
		expect(sftpReadFileMock).toHaveBeenCalledWith("/srv/media/gallery/source.png", expect.any(Function));
		expect(sftpWriteFileMock).toHaveBeenCalledWith("/srv/media/gallery/upload.png", Buffer.from("upload"), expect.any(Function));
	});

	it("builds node-appropriate download URLs for media source links", () => {
		expect(buildStorageFileDownloadUrl({ id: "local_1", driver: "LOCAL" }, "gallery/a b.png", true)).toBe("/api/storage/local?nodeId=local_1&path=gallery%2Fa+b.png&download=1");
		expect(buildStorageFileDownloadUrl({ id: "sftp_1", driver: "SFTP" }, "/gallery/a.png", false)).toBe("/api/storage/sftp-download?nodeId=sftp_1&path=gallery%2Fa.png");
	});
});
