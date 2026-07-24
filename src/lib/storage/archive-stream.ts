import { spawn } from "node:child_process";
import path from "node:path";

import { Client, type ConnectConfig } from "ssh2";
import { connectSsh, type SshConnectionParams } from "@/lib/ssh/client";

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

function destroyReadableWithError(stream: NodeJS.ReadableStream, error: Error) {
	const maybe = stream as NodeJS.ReadableStream & {
		destroyed?: boolean;
		destroy?: (err?: Error) => void;
		emit?: (event: string, ...args: unknown[]) => boolean;
	};
	if (maybe.destroyed) return;
	if (typeof maybe.destroy === "function") {
		maybe.destroy(error);
		return;
	}
	// ssh2 ClientChannel may not expose destroy; surface via error event.
	if (typeof maybe.emit === "function") {
		maybe.emit("error", error);
	}
}

function killSpawnedProcess(child: ReturnType<typeof spawn>, reason: string) {
	if (child.exitCode !== null || child.signalCode !== null || child.killed) return;
	try {
		child.kill("SIGTERM");
	} catch (error) {
		logger.warn("failed to SIGTERM child process", {
			reason,
			message: error instanceof Error ? error.message : String(error),
		});
		return;
	}
	// Escalate if the child ignores SIGTERM (e.g. stuck tar/gzip).
	const timer = setTimeout(() => {
		if (child.exitCode !== null || child.signalCode !== null || child.killed) return;
		try {
			child.kill("SIGKILL");
		} catch (error) {
			logger.warn("failed to SIGKILL child process", {
				reason,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}, 2_000);
	timer.unref?.();
}

export function streamLocalTarGz(directoryPath: string, entryName: string) {
	const tar = spawn("tar", ["-czf", "-", "-C", path.dirname(directoryPath), "--", entryName], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	tar.stderr.on("data", (chunk) => {
		logger.warn("local archive tar stderr", { message: String(chunk).slice(0, 500) });
	});
	const out = tar.stdout;
	// Client abort / Response cancel destroys stdout via nodeStreamToWeb; kill the
	// tar child so cancelled downloads do not leave orphan tar/gzip processes.
	const originalDestroy = out.destroy.bind(out);
	out.destroy = (error?: Error) => {
		killSpawnedProcess(tar, "stdout-destroy");
		return originalDestroy(error);
	};
	tar.on("error", (error) => {
		logger.warn("local archive tar process error", { message: error.message });
		destroyReadableWithError(out, error);
	});
	tar.on("close", (code, signal) => {
		if (code === 0 || code === null) {
			if (signal) {
				const error = new Error(`tar killed by signal ${signal}`);
				logger.warn("local archive tar signal", { signal });
				destroyReadableWithError(out, error);
			}
			return;
		}
		const error = new Error(`tar exited with code ${code}`);
		logger.warn("local archive tar non-zero exit", { code, signal });
		destroyReadableWithError(out, error);
	});
	return out;
}

function shellQuote(value: string) {
	return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}

export function connectArchiveSsh(config: ConnectConfig | SshConnectionParams): Promise<Client> {
	return connectSsh(config);
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
			stream.on("close", (code: number | null, signal: string | null | undefined) => {
				if (code === 0 || code === null) {
					if (signal) {
						const error = new Error(`remote tar killed by signal ${signal}`);
						logger.warn("remote archive tar signal", { signal });
						destroyReadableWithError(stream, error);
					}
					return;
				}
				const error = new Error(`remote tar exited with code ${code}`);
				logger.warn("remote archive tar non-zero exit", { code, signal });
				destroyReadableWithError(stream, error);
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
