import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import path from "node:path";
import { realpathSync } from "node:fs";

import { Client, type ConnectConfig } from "ssh2";
import { connectSsh, type SshConnectionParams } from "@/lib/ssh/client";
import { SFTP_TRANSFER_IDLE_TIMEOUT_MS } from "@/lib/ssh/sftp-timeout";
import { isWindowsStorageBasePath, resolveThroughExistingAncestor } from "./path-utils";
import { IS_WINDOWS } from "@/lib/runtime/platform-paths";
import { resolveLocalTarBinary } from "@/lib/runtime/tar-binary";
import { shellQuote } from "@/lib/shell-quote";
import { localStorageStagingPatterns, storageStagingPatterns } from "./staging-paths";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

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
		if (child.exitCode !== null || child.signalCode !== null) return;
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
	child.once("exit", () => clearTimeout(timer));
}


function archiveExclusionInput(excluded: string[]) {
	if (excluded.some((name) => /[\r\n\0]/.test(name))) throw new ValidationError(t("backend.storage.archiveExclusionInvalid"));
	const input = excluded.length ? `${excluded.join("\n")}\n` : "";
	if (Buffer.byteLength(input) > 1024 * 1024) throw new ValidationError(t("backend.storage.archiveExclusionTooLarge"));
	return input;
}
// libarchive treats backslash as an escape inside an exclusion pattern.
function bsdtarExclude(name: string) {
	return "--exclude=" + name.replace(/[[\\*?]/g, "\\$&");
}

const localStagingExcludes = localStorageStagingPatterns.map(pattern => `--exclude=${pattern}`);
const BSD_TAR = IS_WINDOWS || process.platform === "darwin";
const EXCLUDE_OPTIONS = ["--no-wildcards", "--anchored", "--exclude-from=-"];

/**
 * Windows ships bsdtar (System32\tar.exe), which has no `--exclude-from=-`,
 * `--no-wildcards` or `--anchored`: exclusions become repeated `--exclude`
 * argv entries with literal path characters escaped.
 * resolveLocalTarBinary() pins the System32 bsdtar so a PATH-shadowing GNU
 * tar (which reads "C:\..." as a remote host) can never be picked here.
 */
function buildLocalTarArgs(directoryPath: string, entryName: string, excluded: string[], pinned?: { fd?: number }): string[] {
	// Windows System32 bsdtar does not support -s/--transform; keep the pinned
	// directory handle open in streamLocalTarGz while addressing via -C parent.
	const pinAsDot = Boolean(pinned && !IS_WINDOWS);
	const args = ["-czf", "-"];
	if (!pinAsDot) args.push("-C", path.dirname(directoryPath));
	else if (pinned?.fd !== undefined) args.push("-C", BSD_TAR ? "/dev/fd/3" : "/proc/self/fd/3");
	args.push(...localStagingExcludes);
	const memberRoot = pinAsDot ? "." : entryName;
	if (excluded.length && BSD_TAR) {
		const physicalRoot = realpathSync.native(pinAsDot && pinned?.fd !== undefined ? "/dev/fd/" + pinned.fd : directoryPath);
		let excludeLength = 0;
		for (const name of excluded) {
			// bsdtar matches member spelling. A case-only rename on NTFS may differ from its tombstone.
			const suffix = name.split("/").slice(1).join("/");
			const physical = resolveThroughExistingAncestor(path.join(physicalRoot, suffix));
			if (!physical) throw new ValidationError(t("backend.storage.archiveExclusionInvalid"));
			const member = path.relative(physicalRoot, physical).split(path.sep).join("/");
			if (member.toLowerCase() !== suffix.toLowerCase()) throw new ValidationError(t("backend.storage.archiveExclusionInvalid"));
			const arg = bsdtarExclude(memberRoot + "/" + member);
			excludeLength += arg.length + 1;
			if (excludeLength > 30_000) {
				throw new ValidationError(t("backend.storage.archiveExclusionTooLargeWindows"));
			}
			args.push(arg);
		}
	} else if (excluded.length) {
		args.push(...EXCLUDE_OPTIONS);
	}
	if (pinAsDot) {
		const escaped = entryName.replace(BSD_TAR ? /[\\~|]/g : /[\\&|]/g, "\\$&");
		if (BSD_TAR) args.push("-s", "|^\\.|" + escaped + "|");
		else args.push("--transform=s|^\\.|" + escaped + "|");
	}
	return [...args, "--", memberRoot];
}

/**
 * Exclusions for a tar that reads its members from a list: the options to add, and what the exclusion file
 * must contain (POSIX GNU tar reads it from a file; Windows bsdtar takes each name as an argument).
 */
export function localTarExclusion(excluded: string[], excludeFilePath: string): { options: string[]; fileContent: string | null } {
	if (!excluded.length) return { options: localStagingExcludes, fileContent: null };
	const content = archiveExclusionInput(excluded);
	if (BSD_TAR) return { options: [...localStagingExcludes, ...excluded.map(bsdtarExclude)], fileContent: null };
	return { options: [...localStagingExcludes, "--no-wildcards", "--anchored", `--exclude-from=${excludeFilePath}`], fileContent: content };
}

export function streamLocalTarGz(directoryPath: string, entryName: string, excluded: string[] = [], pinned?: { fd?: number; close: () => Promise<void> }) {
	const pinAsDot = Boolean(pinned && !IS_WINDOWS);
	const pinnedExclusions = pinAsDot ? excluded.map(name => "./" + name.split("/").slice(1).join("/")) : excluded;
	const input = archiveExclusionInput(pinnedExclusions);
	// POSIX GNU tar reads the exclusion list from stdin; Windows bsdtar gets it
	// as argv, so stdin stays closed there.
	const useStdinExcludes = Boolean(input) && !BSD_TAR;
	const args = buildLocalTarArgs(directoryPath, entryName, excluded, pinned);
	const tar = spawn(resolveLocalTarBinary(), args, {
		cwd: pinAsDot && pinned?.fd === undefined ? directoryPath : undefined,
		stdio: [useStdinExcludes ? "pipe" : "ignore", "pipe", "pipe", ...(pinned?.fd === undefined ? [] : [pinned.fd])],
	});
	let exited = false;
	let pinnedClosed = false;
	const releasePinned = () => {
		if (!pinned || pinnedClosed) return Promise.resolve();
		pinnedClosed = true;
		return pinned.close().catch(error => logger.warn("Failed to release archive directory", { error }));
	};
	const out = new PassThrough({
		destroy(error, done) {
			if (!exited) killSpawnedProcess(tar, "stdout-destroy");
			done(error);
		},
	});
	tar.stdout!.on("error", error => out.destroy(error));
	tar.stdout!.pipe(out, { end: false });
	if (useStdinExcludes) {
		tar.stdin?.on("error", (error) => out.destroy(error));
		tar.stdin?.end(input);
	}
	tar.stderr!.on("data", (chunk) => {
		logger.warn("local archive tar stderr", { message: String(chunk).slice(0, 500) });
	});
	tar.on("error", (error) => {
		exited = true;
		void releasePinned();
		logger.warn("local archive tar process error", { message: error.message });
		destroyReadableWithError(out, error);
	});
	tar.on("close", async (code, signal) => {
		exited = true;
		await releasePinned();
		if (code === 0 && !signal) { out.end(); return; }
		if (signal) { out.destroy(new Error(`tar killed by signal ${signal}`)); return; }
		const error = new Error(`tar exited with code ${code}`);
		logger.warn("local archive tar non-zero exit", { code, signal });
		destroyReadableWithError(out, error);
	});
	return out;
}

export function connectArchiveSsh(config: ConnectConfig | SshConnectionParams): Promise<Client> {
	return connectSsh(config);
}

type ArchiveNode = {
	basePath: string;
	host: string | null;
	port: number | null;
	server: { operatingSystem: string; host: string; port: number } | null;
};

/** The tar command below requires the POSIX shell of the bound Linux SSH endpoint. */
export function supportsRemoteTar(node: ArchiveNode): boolean {
	return node.server?.operatingSystem === "LINUX" && !isWindowsStorageBasePath(node.basePath)
		&& (node.host == null || node.host.toLowerCase() === node.server.host.toLowerCase())
		&& (node.port == null || node.port === node.server.port);
}

export async function streamRemoteTarGz(
	client: Client, node: ArchiveNode, remoteDirectoryPath: string, excluded: string[] = [], pinDirectory?: AbortSignal,
) {
	if (!supportsRemoteTar(node)) throw new ValidationError(t("backend.storage.archiveNeedsLinuxSsh"));
	const input = archiveExclusionInput(pinDirectory ? excluded.map(name => "./" + name.split("/").slice(1).join("/")) : excluded);
	const opening = pinDirectory && AbortSignal.any([pinDirectory, AbortSignal.timeout(SFTP_TRANSFER_IDLE_TIMEOUT_MS)]);
	opening?.throwIfAborted();
	let abort: (() => void) | undefined;
	return new Promise<NodeJS.ReadableStream>((resolve, reject) => {
		if (opening) {
			abort = () => { client.destroy(); reject(opening.reason); };
			opening.addEventListener("abort", abort, { once: true });
		}
		const parent = path.posix.dirname(remoteDirectoryPath);
		const name = path.posix.basename(remoteDirectoryPath);
		// GNU tar applies matching options positionally. Keep staging globs before literal tombstones.
		const excludeArgs = [...storageStagingPatterns.map(pattern => shellQuote(`--exclude=${pattern}`)), ...(input ? EXCLUDE_OPTIONS : [])];
		const transform = "--transform=s|^\\.|" + name.replace(/[\\&|]/g, "\\$&") + "|";
		const command = pinDirectory
			? `cd -- ${shellQuote(remoteDirectoryPath)} && printf '\\001' && exec tar -czf - ${excludeArgs.join(" ")} ${shellQuote(transform)} -- .`
			: `tar -czf - -C ${shellQuote(parent)}${excludeArgs.length ? ` ${excludeArgs.join(" ")}` : ""} -- ${shellQuote(name)}`;
		client.exec(command, (err, stream) => {
			if (err) return reject(err);
			if (opening?.aborted) { stream.destroy(); return; }
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
			if (pinDirectory) {
				const cleanup = () => { stream.off("readable", ready); stream.off("close", closed); stream.off("error", reject); };
				const closed = () => { cleanup(); reject(new ValidationError(t("backend.storage.remoteFileMissing"))); };
				const ready = () => {
					const marker = stream.read(1) as Buffer | null;
					if (!marker) return;
					cleanup();
					if (marker[0] !== 1) { stream.destroy(); reject(new ValidationError(t("backend.storage.remoteFileMissing"))); }
					else resolve(stream);
				};
				stream.on("readable", ready).once("close", closed).once("error", reject);
			} else resolve(stream);
			if (input) stream.end(input);
		});
	}).finally(() => { if (abort) opening?.removeEventListener("abort", abort); });
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
