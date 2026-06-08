import { spawn } from "node:child_process";
import path from "node:path";

import { Client, type ConnectConfig } from "ssh2";

import { buildContentDisposition } from "@/lib/http/content-disposition";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import { createLogger } from "@/lib/logging";

const logger = createLogger("storage:archive-stream");

export function safeArchiveName(name: string) {
	const base = path.basename(name).replace(/[^\w.\-\u4e00-\u9fff]+/g, "-");
	return `${base || "folder"}.tar.gz`;
}

export function buildArchiveHeaders(fileName: string) {
	const headers = new Headers();
	headers.set("content-type", "application/gzip");
	headers.set("cache-control", "private, no-store");
	headers.set("content-disposition", buildContentDisposition("attachment", fileName));
	return headers;
}

export function streamLocalTarGz(directoryPath: string, entryName: string) {
	const tar = spawn("tar", ["-czf", "-", "-C", path.dirname(directoryPath), "--", entryName], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	tar.stderr.on("data", (chunk) => {
		logger.warn("local archive tar stderr", { message: String(chunk).slice(0, 500) });
	});
	return tar.stdout;
}

function shellQuote(value: string) {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function connectArchiveSsh(config: ConnectConfig): Promise<Client> {
	return new Promise((resolve, reject) => {
		const client = new Client();
		client.on("ready", () => resolve(client));
		client.on("error", (err) => reject(err));
		client.connect(config);
	});
}

export function streamRemoteTarGz(client: Client, remoteDirectoryPath: string) {
	return new Promise<NodeJS.ReadableStream>((resolve, reject) => {
		const parent = path.posix.dirname(remoteDirectoryPath);
		const name = path.posix.basename(remoteDirectoryPath);
		const command = `tar -czf - -C ${shellQuote(parent)} -- ${shellQuote(name)}`;
		client.exec(command, (err, stream) => {
			if (err) return reject(err);
			stream.stderr.on("data", (chunk: Buffer) => {
				logger.warn("remote archive tar stderr", { message: chunk.toString("utf8").slice(0, 500) });
			});
			resolve(stream);
		});
	});
}

export function archiveStreamResponse(stream: NodeJS.ReadableStream, archiveName: string) {
	return new Response(nodeStreamToWeb(stream), {
		status: 200,
		headers: buildArchiveHeaders(archiveName),
	});
}

export function closeSshClientOnStreamEnd(stream: NodeJS.ReadableStream, client: Client) {
	let closed = false;
	const closeClient = () => {
		if (closed) return;
		closed = true;
		client.end();
	};
	stream.on("close", closeClient);
	stream.on("error", closeClient);
	stream.on("end", closeClient);
}
