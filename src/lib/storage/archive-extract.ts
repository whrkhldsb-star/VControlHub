/**
 * Listing and safe extraction of ZIP and tar archives on LOCAL storage.
 *
 * Extraction never runs an external tool and never creates a link: it reads
 * the archive with the readers in this folder and writes only directories and
 * regular files, under a fresh staging directory beside the destination. A
 * member path is accepted only if it stays inside that directory after
 * normalisation; symlinks, hard links and devices are skipped and counted.
 * Limits on entry count and total size are checked before the first byte is
 * written and again while writing (ZIP sizes are verified with their CRC).
 */
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { walkTar, TarFormatError } from "./tar-reader";
import { openZipEntryStream, readZipEntries, ZipFormatError, type ZipEntry } from "./zip-reader";

export const MAX_EXTRACT_ENTRIES = 20_000;
export const MAX_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024;

export type ArchiveKind = "zip" | "tar" | "tar.gz";

export type ArchiveListEntry = {
	name: string;
	size: number;
	isDirectory: boolean;
	modified?: string;
};

export type ArchiveExtractErrorCode = "unsafePath" | "tooManyEntries" | "tooLarge" | "encrypted" | "unsupportedMethod" | "corrupt" | "empty" | "duplicateName";

export class ArchiveExtractError extends Error {
	constructor(readonly code: ArchiveExtractErrorCode, readonly detail = "") {
		super(detail ? `${code}: ${detail}` : code);
	}
}

/** Formats this module reads itself; `.gz`, `.7z` and `.rar` are handled elsewhere. */
export function archiveKindOf(name: string): ArchiveKind | null {
	const lower = name.toLowerCase();
	if (lower.endsWith(".zip") || lower.endsWith(".jar")) return "zip";
	if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
	if (lower.endsWith(".tar")) return "tar";
	return null;
}

/** "photos-2026.tar.gz" → "photos-2026": the folder an archive extracts into. */
export function archiveBaseName(name: string): string {
	const base = name.replace(/\.(tar\.gz|tgz|tar|zip|jar)$/i, "").trim();
	return base || "archive";
}

/**
 * Member path relative to the extraction root, or null for the root itself.
 * Leading "/" and "./" are dropped as tar does; ".." anywhere, drive letters
 * and NUL make the whole archive unsafe.
 */
export function normalizeMemberPath(name: string): string | null {
	const cleaned = name.replace(/\\/g, "/");
	if (cleaned.includes("\0") || /^[A-Za-z]:/.test(cleaned)) throw new ArchiveExtractError("unsafePath", name);
	const segments = cleaned.split("/").filter((segment) => segment !== "" && segment !== ".");
	if (segments.some((segment) => segment === ".." || /[\u0000-\u001f]/.test(segment))) throw new ArchiveExtractError("unsafePath", name);
	return segments.length ? segments.join("/") : null;
}

function formatError(error: unknown): never {
	if (error instanceof ZipFormatError || error instanceof TarFormatError) throw new ArchiveExtractError("corrupt", error.message);
	throw error;
}

/* ── Listing ─────────────────────────────────────────────────────────── */

export async function listArchive(filePath: string, kind: ArchiveKind): Promise<ArchiveListEntry[]> {
	try {
		if (kind === "zip") {
			const entries = await readZipEntries(filePath, { maxEntries: MAX_EXTRACT_ENTRIES * 5 });
			return entries.map((entry) => ({
				name: entry.name.replace(/\/+$/, ""),
				size: entry.isDirectory ? 0 : entry.size,
				isDirectory: entry.isDirectory,
				modified: entry.modified?.toISOString(),
			}));
		}
		const entries: ArchiveListEntry[] = [];
		await walkTar(filePath, kind === "tar.gz", async (member) => {
			if (entries.length >= MAX_EXTRACT_ENTRIES * 5) throw new ArchiveExtractError("tooManyEntries", String(entries.length));
			entries.push({
				name: member.name.replace(/\/+$/, ""),
				size: member.size,
				isDirectory: member.type === "directory",
				modified: member.modified?.toISOString(),
			});
		});
		return entries;
	} catch (error) {
		return formatError(error);
	}
}

/* ── Planning ────────────────────────────────────────────────────────── */

export type ExtractionPlan = {
	files: number;
	directories: number;
	totalBytes: number;
	/** Links and special files, which are never extracted. */
	skipped: number;
	/** The single top-level folder every member sits in, if there is one. */
	singleRoot: string | null;
};

function planner() {
	const roots = new Set<string>();
	let rootIsFile = false;
	const plan: ExtractionPlan = { files: 0, directories: 0, totalBytes: 0, skipped: 0, singleRoot: null };
	return {
		plan,
		add(relative: string | null, kind: "file" | "directory" | "skip", size: number) {
			if (kind === "skip") {
				plan.skipped++;
				return;
			}
			if (!relative) return;
			const [root, ...rest] = relative.split("/");
			roots.add(root!);
			if (kind === "file" && rest.length === 0) rootIsFile = true;
			if (kind === "directory") plan.directories++;
			else plan.files++;
			plan.totalBytes += size;
			if (plan.files + plan.directories > MAX_EXTRACT_ENTRIES) throw new ArchiveExtractError("tooManyEntries", String(MAX_EXTRACT_ENTRIES));
			if (plan.totalBytes > MAX_EXTRACT_BYTES) throw new ArchiveExtractError("tooLarge", String(MAX_EXTRACT_BYTES));
		},
		finish() {
			if (plan.files + plan.directories === 0) throw new ArchiveExtractError("empty");
			plan.singleRoot = roots.size === 1 && !rootIsFile ? [...roots][0]! : null;
			return plan;
		},
	};
}

function zipMemberKind(entry: ZipEntry): "file" | "directory" | "skip" {
	if (entry.isSymlink) return "skip";
	if (entry.isDirectory) return "directory";
	if (entry.encrypted) throw new ArchiveExtractError("encrypted", entry.name);
	if (entry.method !== 0 && entry.method !== 8) throw new ArchiveExtractError("unsupportedMethod", `${entry.name} (${entry.method})`);
	return "file";
}

/** Checks every member and the limits without writing anything. */
export async function planExtraction(filePath: string, kind: ArchiveKind): Promise<ExtractionPlan> {
	const builder = planner();
	try {
		if (kind === "zip") {
			// Two members under one name would leave only the second file, while
			// extraction still reported both as written. Refuse instead.
			const files = new Set<string>();
			for (const entry of await readZipEntries(filePath, { maxEntries: MAX_EXTRACT_ENTRIES })) {
				const memberKind = zipMemberKind(entry);
				const relative = memberKind === "skip" ? null : normalizeMemberPath(entry.name);
				if (memberKind === "file" && relative) {
					if (files.has(relative)) throw new ArchiveExtractError("duplicateName", relative);
					files.add(relative);
				}
				builder.add(relative, memberKind, memberKind === "file" ? entry.size : 0);
			}
		} else {
			await walkTar(filePath, kind === "tar.gz", async (member) => {
				const memberKind = member.type === "file" || member.type === "directory" ? member.type : "skip";
				builder.add(memberKind === "skip" ? null : normalizeMemberPath(member.name), memberKind, member.size);
			});
		}
	} catch (error) {
		formatError(error);
	}
	return builder.finish();
}

/* ── Extraction ──────────────────────────────────────────────────────── */

/** Absolute path of a member under `root`; refuses anything that escapes it. */
function memberTarget(root: string, relative: string): string {
	const target = path.resolve(root, ...relative.split("/"));
	if (!target.startsWith(root + path.sep)) throw new ArchiveExtractError("unsafePath", relative);
	return target;
}

async function writeMember(root: string, relative: string, content: Readable | AsyncIterable<Buffer>, budget: { left: number }) {
	const target = memberTarget(root, relative);
	await mkdir(path.dirname(target), { recursive: true });
	// A later duplicate replaces an earlier one, as with tar and unzip -o.
	await rm(target, { force: true, recursive: false }).catch(() => undefined);
	const counted = async function* () {
		for await (const chunk of content as AsyncIterable<Buffer>) {
			budget.left -= chunk.length;
			if (budget.left < 0) throw new ArchiveExtractError("tooLarge", String(MAX_EXTRACT_BYTES));
			yield chunk;
		}
	};
	await pipeline(Readable.from(counted()), createWriteStream(target, { flags: "wx" }));
}

async function extractInto(filePath: string, kind: ArchiveKind, root: string, plan: ExtractionPlan) {
	// Same bound as planned: a file rewritten between planning and extraction cannot grow past it.
	const budget = { left: plan.totalBytes };
	if (kind === "zip") {
		const handle = await open(filePath, "r");
		try {
			for (const entry of await readZipEntries(handle, { maxEntries: MAX_EXTRACT_ENTRIES })) {
				const memberKind = zipMemberKind(entry);
				const relative = memberKind === "skip" ? null : normalizeMemberPath(entry.name);
				if (!relative) continue;
				if (memberKind === "directory") await mkdir(memberTarget(root, relative), { recursive: true });
				else await writeMember(root, relative, await openZipEntryStream(handle, entry), budget);
			}
		} finally {
			await handle.close();
		}
		return;
	}
	await walkTar(filePath, kind === "tar.gz", async (member, content) => {
		if (member.type !== "file" && member.type !== "directory") return;
		const relative = normalizeMemberPath(member.name);
		if (!relative) return;
		if (member.type === "directory") await mkdir(memberTarget(root, relative), { recursive: true });
		else await writeMember(root, relative, content, budget);
	});
}

/** Defence in depth: the staged tree may only hold directories and regular files. */
async function assertPlainTree(directory: string): Promise<string[]> {
	const directories = [directory];
	for (let index = 0; index < directories.length; index++) {
		for (const entry of await readdir(directories[index]!, { withFileTypes: true })) {
			const full = path.join(directories[index]!, entry.name);
			const stat = await lstat(full);
			if (stat.isDirectory()) directories.push(full);
			else if (!stat.isFile()) throw new ArchiveExtractError("unsafePath", entry.name);
		}
	}
	return directories;
}

async function exists(target: string) {
	try {
		await lstat(target);
		return true;
	} catch {
		return false;
	}
}

/** "name", "name (2)", "name (3)"… — the first that is free in `parent`. */
async function freeName(parent: string, name: string): Promise<string> {
	for (let attempt = 1; attempt <= 1000; attempt++) {
		const candidate = attempt === 1 ? name : `${name} (${attempt})`;
		if (!(await exists(path.join(parent, candidate)))) return candidate;
	}
	throw new ArchiveExtractError("unsafePath", name);
}

export type ExtractionResult = ExtractionPlan & {
	/** Name of the new folder created in `parentDir`. */
	folderName: string;
	/** Absolute paths of every directory created, the new folder first. */
	createdDirectories: string[];
};

/**
 * Extract into a new folder in `parentDir`: the archive's single top-level
 * folder when it has one, otherwise a folder named after the archive. Never
 * writes into an existing folder; a taken name gets " (2)", " (3)"….
 */
export async function extractArchive({ filePath, kind, archiveName, parentDir, plan }: {
	filePath: string;
	kind: ArchiveKind;
	archiveName: string;
	parentDir: string;
	plan: ExtractionPlan;
}): Promise<ExtractionResult> {
	const staging = path.join(parentDir, `.vch-extract-${randomUUID()}.tmp`);
	await mkdir(staging);
	try {
		try {
			await extractInto(filePath, kind, staging, plan);
		} catch (error) {
			formatError(error);
		}
		await assertPlainTree(staging);
		const source = plan.singleRoot ? path.join(staging, plan.singleRoot) : staging;
		const folderName = await freeName(parentDir, plan.singleRoot ?? archiveBaseName(archiveName));
		const destination = path.join(parentDir, folderName);
		await rename(source, destination);
		return { ...plan, folderName, createdDirectories: await assertPlainTree(destination) };
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}
