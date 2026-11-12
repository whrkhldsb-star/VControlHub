/**
 * Listing of .7z and .rar archives, the two formats this application does not read itself: the server's own
 * `7z` / `unrar` is asked for its technical listing (`7z l -slt`, `unrar lt`), one `key = value` block per entry.
 *
 * The column listings (`7z l`, `unrar l`) were parsed before, by patterns that matched no real output: 7-Zip marks
 * a file `....A` and leaves the packed size blank inside a solid block, so only directories were listed; unrar 5
 * and later (2013) print `2026-11-11 10:41` with no packed size or ratio, so nothing was listed at all.
 */
import { execFile } from "node:child_process";

import type { ArchiveListEntry } from "./archive-extract";

export type ExternalArchiveKind = "7z" | "rar";

export type ExternalArchiveErrorCode = "toolMissing" | "passwordProtected" | "listingTooLarge" | "unreadable";

export class ExternalArchiveError extends Error {
	constructor(readonly code: ExternalArchiveErrorCode, readonly kind: ExternalArchiveKind, readonly detail = "") {
		super(detail ? `${code}: ${detail}` : code);
	}
}

/** The command each format is listed with. */
export const EXTERNAL_ARCHIVE_TOOL: Record<ExternalArchiveKind, string> = { "7z": "7z", rar: "unrar" };

const LISTING_TIMEOUT_MS = 15_000;
const LISTING_MAX_BYTES = 16 * 1024 * 1024;
/** Given to 7z so that it fails on an archive whose file list is encrypted instead of waiting for a password. */
const NO_PASSWORD = "vch-no-password";

function toSeconds(value: string | undefined): string | undefined {
	// "2026-11-11 10:41:55.2714158" (7z) and "2026-11-11 10:41:55,267936505" (unrar).
	const match = value?.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?/);
	return match ? match[0] : undefined;
}

/** Entries of `7z l -slt`: the blocks after the line of ten dashes that ends the archive's own properties. */
export function parse7zTechnicalListing(stdout: string): ArchiveListEntry[] {
	const lines = stdout.split(/\r?\n/);
	const start = lines.indexOf("----------");
	if (start < 0) return [];
	const entries: ArchiveListEntry[] = [];
	let block: Record<string, string> | null = null;
	const flush = () => {
		if (block && block.Path) {
			// "Folder = +" (older p7zip) or attributes that start with D ("D drwxr-xr-x", "D....").
			const isDirectory = block.Folder === "+" || /^D/.test(block.Attributes ?? "");
			const modified = toSeconds(block.Modified);
			entries.push({ name: block.Path, size: Number(block.Size) || 0, isDirectory, ...(modified ? { modified } : {}) });
		}
		block = null;
	};
	for (const line of lines.slice(start + 1)) {
		if (line === "") {
			flush();
			continue;
		}
		const separator = line.indexOf(" = ");
		// "CRC = " and the like end with the separator's first two characters only.
		const key = separator >= 0 ? line.slice(0, separator) : line.replace(/ =$/, "");
		const value = separator >= 0 ? line.slice(separator + 3) : "";
		if (key === "Path") {
			flush();
			block = { Path: value };
		} else if (block && !(key in block)) {
			block[key] = value;
		}
	}
	flush();
	return entries;
}

/** Entries of `unrar lt`: a block of right-aligned `Key: value` lines per entry, beginning with its name. */
export function parseUnrarTechnicalListing(stdout: string): ArchiveListEntry[] {
	const entries: ArchiveListEntry[] = [];
	let block: Record<string, string> | null = null;
	const flush = () => {
		if (block && block.Name) {
			const modified = toSeconds(block.mtime);
			// "File", "Directory", "Unix symbolic link", "Hard link", "File copy": only a directory holds entries.
			entries.push({ name: block.Name, size: Number(block.Size) || 0, isDirectory: block.Type === "Directory", ...(modified ? { modified } : {}) });
		}
		block = null;
	};
	for (const line of stdout.split(/\r?\n/)) {
		if (line.trim() === "") {
			flush();
			continue;
		}
		const name = line.match(/^\s*Name: (.*)$/);
		if (name) {
			flush();
			block = { Name: name[1]! };
			continue;
		}
		const field = block ? line.match(/^\s*([A-Za-z][A-Za-z0-9 ]*?): (.*)$/) : null;
		if (field && block && !(field[1]! in block)) block[field[1]!] = field[2]!;
	}
	flush();
	return entries;
}

function run(binary: string, args: string[]): Promise<{ stdout: string; stderr: string; failed: boolean; errorCode?: string }> {
	return new Promise((resolve) => {
		const child = execFile(
			binary,
			args,
			{
				maxBuffer: LISTING_MAX_BYTES,
				timeout: LISTING_TIMEOUT_MS,
				// The service runs in the C locale, where unrar prints every non-ASCII character of a name as "?".
				env: { ...process.env, LC_ALL: "C.UTF-8", LANG: "C.UTF-8" },
			},
			(error, stdout, stderr) => {
				resolve({ stdout, stderr, failed: Boolean(error), errorCode: error ? String((error as NodeJS.ErrnoException).code ?? "") : undefined });
			},
		);
		// Nothing to type: a tool that asks for a password reads end-of-file at once instead of waiting out the timeout.
		child.stdin?.end();
	});
}

/**
 * The entries of a .7z or .rar archive, as the server's own tool lists them.
 * Throws ExternalArchiveError: the tool is not installed, the file list is encrypted, or the file cannot be read.
 */
export async function listExternalArchive(
	kind: ExternalArchiveKind,
	filePath: string,
	options: { binary?: string } = {},
): Promise<ArchiveListEntry[]> {
	const binary = options.binary ?? EXTERNAL_ARCHIVE_TOOL[kind];
	const args = kind === "7z"
		// -sccUTF-8: piped output otherwise uses the console codepage on Windows, mangling every non-ASCII name.
		? ["l", "-slt", "-sccUTF-8", `-p${NO_PASSWORD}`, "--", filePath]
		// -p- never asks for a password, -c- leaves the archive comment out.
		: ["lt", "-p-", "-c-", "--", filePath];
	const result = await run(binary, args);
	const output = `${result.stdout}\n${result.stderr}`;
	if (result.errorCode === "ENOENT") throw new ExternalArchiveError("toolMissing", kind, binary);
	if (result.errorCode === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw new ExternalArchiveError("listingTooLarge", kind);
	if (/Wrong password|encrypted archive|Incorrect password|encrypted headers/i.test(output)) {
		throw new ExternalArchiveError("passwordProtected", kind);
	}
	// unrar answers "is not RAR archive" with exit status 0.
	if (result.failed || /is not RAR archive|Is not archive|Cannot open the file as/i.test(output)) {
		const detail = output.split(/\r?\n/).map((line) => line.trim()).find((line) => /error|cannot|not .*archive/i.test(line)) ?? "";
		throw new ExternalArchiveError("unreadable", kind, detail.slice(0, 200));
	}
	const entries = kind === "7z" ? parse7zTechnicalListing(result.stdout) : parseUnrarTechnicalListing(result.stdout);
	// The Windows tools print the host's path separator; an archive name is written one way everywhere.
	return process.platform === "win32" ? entries.map((entry) => ({ ...entry, name: entry.name.replace(/\\/g, "/") })) : entries;
}
