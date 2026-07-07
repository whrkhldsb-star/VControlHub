import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Client, type ConnectConfig } from "ssh2";

import { connectSsh } from "@/lib/ssh/client";
import { prisma } from "@/lib/db";
import { BusinessError, ValidationError } from "@/lib/errors";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { normalizeRemoteTargetPath, normalizeRemoteRelativePath } from "@/lib/storage/remote-path";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";

export type StorageFileNode = {
	id: string;
	driver: "LOCAL" | "SFTP" | string;
	basePath: string;
	host?: string | null;
	port?: number | null;
	username?: string | null;
	password?: string | null;
	serverId?: string | null;
	server?: {
		id?: string;
		host?: string | null;
		port?: number | null;
		username?: string | null;
		connectionType?: string | null;
		password?: string | null;
		sshKey?: { privateKey?: string | null } | null;
	} | null;
};

export const storageFileNodeSelect = {
	id: true,
	driver: true,
	basePath: true,
	host: true,
	port: true,
	username: true,
	serverId: true,
	server: {
		select: {
			id: true,
			host: true,
			port: true,
			username: true,
			connectionType: true,
			password: true,
			sshKey: {
				select: {
					privateKey: true,
				},
			},
		},
	},
} as const;

function sftpReadFile(client: Client, remotePath: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		client.sftp((err, sftp) => {
			if (err) return reject(err);
			sftp.readFile(remotePath, (readErr, data) => {
				if (readErr) return reject(readErr);
				resolve(Buffer.isBuffer(data) ? data : Buffer.from(data));
			});
		});
	});
}

export async function readStorageFileBuffer(node: StorageFileNode, relativePath: string) {
	if (node.driver === "LOCAL") {
		const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
		if (!resolved.ok) throw new ValidationError(resolved.reason);
		return readFile(resolved.path);
	}

	if (node.driver === "SFTP") {
		const credentials = resolveStorageSshCredentials(node);
		const normalizedRemotePath = normalizeRemoteTargetPath(node.basePath, relativePath);
		let client: Client | null = null;
		try {
			client = await connectSsh({
				host: credentials.host,
				port: credentials.port,
				username: credentials.username,
				hostKeySha256: credentials.hostKeySha256,
				privateKey: credentials.privateKey,
				password: credentials.password,
				readyTimeout: 15000,
				timeout: 10000,
			});
			return await sftpReadFile(client, normalizedRemotePath);
		} finally {
			client?.end();
		}
	}

	throw new BusinessError("Unsupported storage node type");
}

function sftpMkdir(client: Client, remoteDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		client.sftp((err, sftp) => {
			if (err) return reject(err);
			const normalized = normalizeRemoteRelativePath(remoteDir).replace(/\/$/, "");
			const absolute = remoteDir.startsWith("/");
			const segments = normalized.split("/").filter(Boolean);
			let current = absolute ? "/" : "";
			const ensureNext = (index: number) => {
				if (index >= segments.length) return resolve();
				current = current === "/" ? `/${segments[index]!}` : current ? `${current}/${segments[index]!}` : segments[index]!;
				sftp.stat(current, (statErr) => {
					if (!statErr) return ensureNext(index + 1);
					sftp.mkdir(current, (mkdirErr) => {
						if (mkdirErr && !String(mkdirErr.message || mkdirErr).includes("Failure")) return reject(mkdirErr);
						ensureNext(index + 1);
					});
				});
			};
			ensureNext(0);
		});
	});
}

function sftpWriteFile(client: Client, remotePath: string, buffer: Buffer): Promise<void> {
	return new Promise((resolve, reject) => {
		client.sftp((err, sftp) => {
			if (err) return reject(err);
			sftp.writeFile(remotePath, buffer, (writeErr) => {
				if (writeErr) return reject(writeErr);
				resolve();
			});
		});
	});
}

export async function writeStorageFileBuffer(node: StorageFileNode, relativePath: string, buffer: Buffer) {
	if (node.driver === "LOCAL") {
		const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
		if (!resolved.ok) throw new ValidationError(resolved.reason);
		await mkdir(path.dirname(resolved.path), { recursive: true });
		await writeFile(resolved.path, buffer);
		return resolved.path;
	}

	if (node.driver === "SFTP") {
		const credentials = resolveStorageSshCredentials(node);
		const normalizedRemotePath = normalizeRemoteTargetPath(node.basePath, relativePath);
		let client: Client | null = null;
		try {
			client = await connectSsh({
				host: credentials.host,
				port: credentials.port,
				username: credentials.username,
				hostKeySha256: credentials.hostKeySha256,
				privateKey: credentials.privateKey,
				password: credentials.password,
				readyTimeout: 15000,
				timeout: 10000,
			});
			await sftpMkdir(client, path.posix.dirname(normalizedRemotePath));
			await sftpWriteFile(client, normalizedRemotePath, buffer);
			return normalizedRemotePath;
		} finally {
			client?.end();
		}
	}

	throw new BusinessError("Unsupported storage node type");
}

export function buildStorageFileDownloadUrl(node: Pick<StorageFileNode, "id" | "driver">, relativePath: string, download = false) {
	const params = new URLSearchParams({ nodeId: node.id, path: normalizeRemoteRelativePath(relativePath) });
	if (download) params.set("download", "1");
	if (node.driver === "SFTP") return `/api/storage/sftp-download?${params.toString()}`;
	return `/api/storage/local?${params.toString()}`;
}

export async function getStorageFileNode(storageNodeId: string) {
	return prisma.storageNode.findUnique({
		where: { id: storageNodeId },
		select: storageFileNodeSelect,
	});
}
