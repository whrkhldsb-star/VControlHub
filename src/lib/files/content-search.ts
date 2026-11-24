/**
 * FEAT-P0-4: File content search service.
 *
 * Searches file *contents* (not just filenames) across storage nodes:
 * - LOCAL nodes: uses Node.js `fs` to recursively read files and search
 * - SFTP nodes: executes `grep -rl` on the remote server via SSH
 *
 * Security:
 * - Search paths are constrained to the storage node's basePath
 * - Search query is sanitized to prevent shell injection (SFTP path)
 * - Results are capped to prevent DoS (max 100 files, max 5 lines each)
 * - Only text files are searched (binary files skipped via grep -I)
 */
import fs from "node:fs/promises";
import { indexedAncestors } from "@/lib/storage/archive-access";
import { getRuntimeSettingNumberCached } from "@/lib/runtime-settings/cached";
import path from "node:path";

import { createLogger } from "@/lib/logging";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { RoleKey } from "@/lib/auth/rbac";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import type { SessionPayload } from "@/lib/auth/session";

type ContentSearchSession = {
	userId: string;
	roles: RoleKey[];
	currentTeamId: string | null;
};

import { execRemoteCommand } from "@/lib/ssh/client";
import { resolveStorageSshCredentials, STORAGE_SSH_SERVER_SELECT } from "@/lib/storage/ssh-credentials";
import { resolveLocalAbsolutePath } from "@/lib/storage/service-entries";
import { expandStorageBasePath, hasCaseInsensitiveLocalPaths } from "@/lib/storage/path-utils";
import { normalizeRemotePath, normalizeRemoteRelativePath } from "@/lib/storage/remote-path";

import { shellQuote } from "@/lib/shell-quote";


const logger = createLogger("files:content-search");

export type ContentSearchResult = {
	filePath: string;
	relativePath: string;
	nodeId: string;
	nodeName: string;
	nodeDriver: string;
	snippets: string[];
};

export type ContentSearchResponse = {
	results: ContentSearchResult[];
	totalMatches: number;
	truncated: boolean;
};

const MAX_RESULTS = 100;
/** Directory levels a LOCAL search descends; deeper ones count as not searched. */
const MAX_DEPTH = 10;
/** Budgets for a LOCAL content search: a tree walk per request stops here (A4-11). */
const LOCAL_SEARCH_TIME_BUDGET_MS = 10_000;
const LOCAL_SEARCH_FILE_BUDGET = 5_000;

/** One node's matches, and whether it stopped before finding them all. */
type NodeSearchOutcome = { results: ContentSearchResult[]; truncated: boolean };
const MAX_SNIPPETS_PER_FILE = 5;
const MAX_SNIPPET_LENGTH = 200;
/** Files above `storage.contentSearchMaxFileBytes` (default 1 MiB) are skipped. */
const maxFileSizeBytes = () => getRuntimeSettingNumberCached("storage.contentSearchMaxFileBytes");
const SEARCH_TIMEOUT_MS = 30_000;

// Text file extensions to search for LOCAL nodes
const SEARCHABLE_EXTENSIONS = new Set([
	".txt", ".log", ".md", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
	".conf", ".env", ".sh", ".bash", ".py", ".js", ".ts", ".jsx", ".tsx",
	".html", ".css", ".scss", ".xml", ".sql", ".csv", ".tsv", ".go", ".rs",
	".java", ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".pl", ".swift",
	".kt", ".scala", ".lua", ".r", ".vue", ".svelte", ".gitignore",
	".dockerfile", ".makefile", ".gradle", ".properties",
]);

// Files without extension that should be searched
const SEARCHABLE_NO_EXT_NAMES = new Set([
	"dockerfile", "makefile", "readme", "license", "changelog",
	"gitignore", "npmrc", "editorconfig", "env",
]);

/**
 * The same files for a remote node's grep, which matches names by glob and by case: "*.ext" for each
 * extension (it also matches ".ext", so ".env" and ".gitignore"), and each whole name as it is usually
 * written. The remote command once carried its own list of 43 extensions, which had drifted from the one
 * above: a search found a Dockerfile, a README or build.gradle on a local node and not on a remote one.
 */
const REMOTE_SEARCH_INCLUDES = [
	...[...SEARCHABLE_EXTENSIONS].map((ext) => `*${ext}`),
	...[...SEARCHABLE_NO_EXT_NAMES].flatMap((name) => [name, name[0]!.toUpperCase() + name.slice(1), name.toUpperCase()]),
].map((glob) => `--include='${glob}'`).join(" ");

function isSearchableFile(filename: string): boolean {
	const lower = filename.toLowerCase();
	const ext = path.extname(lower);
	if (ext && SEARCHABLE_EXTENSIONS.has(ext)) return true;
	if (!ext && SEARCHABLE_NO_EXT_NAMES.has(lower)) return true;
	// ".env", ".gitignore", ".npmrc": Node gives a leading-dot name no
	// extension, and the name list was written without the dot, so neither
	// check matched and these files were never searched.
	if (!ext && lower.startsWith(".") && SEARCHABLE_NO_EXT_NAMES.has(lower.slice(1))) return true;
	return false;
}

function truncateSnippet(line: string): string {
	const trimmed = line.trim();
	if (trimmed.length <= MAX_SNIPPET_LENGTH) return trimmed;
	return trimmed.slice(0, MAX_SNIPPET_LENGTH) + "...";
}

/**
 * Escape a string for use in grep's basic regex (SFTP/remote path).
 * We use `grep -F` (fixed string) to avoid regex injection entirely.
 */
export function sanitizeSearchQuery(query: string): string {
	// Remove null bytes and control characters
	return query.replace(/[\x00-\x1f\x7f]/g, "");
}

/**
 * Search LOCAL storage node by recursively reading files.
 */
async function searchLocalNode(
	nodeId: string,
	nodeName: string,
	basePath: string,
	query: string,
	searchPath: string,
	/** Paths among these that are in the recycle bin. */
	deletedAmong: (relativePaths: string[]) => Promise<Set<string>> = async () => new Set(),
): Promise<NodeSearchOutcome> {
	const results: ContentSearchResult[] = [];
	// Set when the walk stopped early (result cap, depth cap): the caller
	// must say the results are incomplete instead of presenting them as all.
	let truncated = false;
	const lowerQuery = query.toLowerCase();
	const nodeRoot = path.resolve(expandStorageBasePath(basePath));
	// No path means the whole node. resolveLocalAbsolutePath rejects the empty
	// path (it resolves file targets), which made every default search of a
	// LOCAL node fail and return nothing. A sub-path keeps its containment
	// check, including the symlink-aware one.
	const searchRoot = searchPath ? resolveLocalAbsolutePath(basePath, searchPath) : nodeRoot;

	logger.debug("Local content search", { nodeId, searchRoot, query });

	// Recycle-bin files keep their bytes on disk, so the walk finds them;
	// they are dropped before they count against the result cap. Filtered
	// only afterwards, 100 deleted matches used up the cap and every live
	// match was missed.
	let checked = 0;
	async function dropDeletedMatches() {
		const fresh = results.slice(checked);
		const deleted = await deletedAmong(fresh.map((result) => result.relativePath));
		if (deleted.size > 0) {
			const kept = fresh.filter((result) => !deleted.has(result.relativePath));
			results.splice(checked, fresh.length, ...kept);
		}
		checked = results.length;
	}
	const full = async () => {
		if (results.length <= MAX_RESULTS) return false;
		await dropDeletedMatches();
		return results.length > MAX_RESULTS;
	};

	// A query with no hit used to read the whole tree on every keystroke (A4-11):
	// stop after a time or file budget and say the result is partial.
	const startedAt = Date.now();
	let filesRead = 0;
	const overBudget = () => {
		if (Date.now() - startedAt > LOCAL_SEARCH_TIME_BUDGET_MS || filesRead >= LOCAL_SEARCH_FILE_BUDGET) {
			truncated = true;
			return true;
		}
		return false;
	};
	async function walk(dir: string, depth: number): Promise<void> {
		if (await full() || overBudget()) return;
		if (depth > MAX_DEPTH) {
			truncated = true;
			return;
		}

		let entries: import("node:fs").Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return; // Permission denied or not a directory
		}

		for (const entry of entries) {
			// One match past the cap tells that there were more.
			if (await full() || overBudget()) return;

			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				// Skip hidden directories and common non-searchable dirs
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
				await walk(fullPath, depth + 1);
			} else if (entry.isFile() && isSearchableFile(entry.name)) {
				try {
					const stat = await fs.stat(fullPath);
					if (stat.size > maxFileSizeBytes()) continue;

					filesRead += 1;
					const content = await fs.readFile(fullPath, "utf-8");
					const lines: string[] = content.split("\n");
					const snippets: string[] = [];

					for (let i = 0; i < lines.length && snippets.length < MAX_SNIPPETS_PER_FILE; i++) {
						const line = lines[i];
						if (line && line.toLowerCase().includes(lowerQuery)) {
							snippets.push(truncateSnippet(line));
						}
					}

					if (snippets.length > 0) {
						const relativePath = path.relative(nodeRoot, fullPath).split(path.sep).join("/");
						results.push({
							filePath: fullPath,
							relativePath,
							nodeId,
							nodeName,
							nodeDriver: "LOCAL",
							snippets,
						});
					}
				} catch {
					// Skip files we can't read
				}
			}
		}
	}

	await walk(searchRoot, 0);
	await dropDeletedMatches();
	return { results: results.slice(0, MAX_RESULTS), truncated: truncated || results.length > MAX_RESULTS };
}

/**
 * Search SFTP storage node by executing `grep -rlF` on the remote server.
 */
async function searchSftpNode(
	target: { id: string; name: string; basePath: string; teamId: string | null },
	query: string,
	searchPath: string,
	deletedAmong: (relativePaths: string[]) => Promise<Set<string>> = async () => new Set(),
): Promise<NodeSearchOutcome> {
	const { id: nodeId, name: nodeName, basePath } = target;
	const none: NodeSearchOutcome = { results: [], truncated: false };
	const sanitizedQuery = sanitizeSearchQuery(query);

	// The node as file operations load it (sftp-node.ts): its own endpoint
	// overrides, the server's credentials and how it is managed. Built from
	// the server alone with no key id and no connection type, a key-based
	// server was treated as a password one without a password, so every
	// search of it failed and returned nothing; overrides and Agent-managed
	// servers were ignored too.
	const node = await prisma.storageNode.findUnique({
		where: { id: nodeId, teamId: target.teamId, driver: "SFTP", basePath },
		select: {
			id: true,
			name: true,
			basePath: true,
			host: true,
			port: true,
			username: true,
			teamId: true,
			hostKeySha256: true,
			server: { select: STORAGE_SSH_SERVER_SELECT },
		},
	});

	if (!node || !node.server) {
		logger.warn("SFTP node has no associated server", { nodeId });
		return none;
	}

	// The search runs `grep` over SSH exec. Windows OpenSSH sessions default to
	// cmd/PowerShell with no grep — attempting it burned an exec round-trip and
	// logged an error per search. Skip explicitly until a PowerShell/Select-String
	// backend exists; filename search (the files page) still covers these nodes.
	if (node.server.operatingSystem === "WINDOWS") {
		logger.info("SFTP content search skipped: Windows node has no grep", { nodeId });
		return none;
	}

	const sshParams = resolveStorageSshCredentials(node);

	const remoteRoot = normalizeRemotePath(basePath);
	const remoteSearchPath = path.posix.join(remoteRoot, searchPath);

	// Use grep -r (recursive) -F (fixed string, no regex) -I (skip binary)
	// -l (list filenames only) --include to limit file types
	// Then for each matching file, grep -n to get line numbers + content
	// grep follows a symlink given as its starting point, so a link inside the
	// node pointing elsewhere would be searched (and its lines returned). The
	// physical (symlink-free) search path must be exactly the physical node
	// root joined with the requested path — the storage containment rule (see
	// remote-containment.ts): no link hop below the root, which also keeps a
	// path grant from reaching a sibling through a link. Recursion itself
	// (grep -r) does not follow links below the starting point.
	const containment = [
		`root=$(cd -P -- ${shellQuote(remoteRoot)} 2>/dev/null && pwd -P) || exit 2`,
		`target=$(cd -P -- ${shellQuote(remoteSearchPath)} 2>/dev/null && pwd -P) || exit 2`,
		`expected="\${root%/}"${searchPath ? shellQuote(`/${searchPath}`) : ""}`,
		'[ "$target" = "${expected:-/}" ] || exit 3',
	].join("\n");
	// NUL separates complete names, even when a file contains a newline. Base64
	// carries this list through both SSH and the Agent's text result store.
	const grepCmd = `${containment}\ngrep -rFIlZ ${REMOTE_SEARCH_INCLUDES} --max-count=${MAX_SNIPPETS_PER_FILE} -- ${shellQuote(sanitizedQuery)} ${shellQuote(remoteSearchPath)} 2>/dev/null | head -z -n ${MAX_RESULTS + 1} | base64`;

	logger.debug("Remote content search", { nodeId, remoteSearchPath, query: sanitizedQuery });

	try {
		const result = await execRemoteCommand({
			...sshParams,
			command: grepCmd,
			timeout: SEARCH_TIMEOUT_MS,
		});

		if (result.exitCode === 3) {
			logger.warn("SFTP content search rejected: search path resolves outside the node root", { nodeId, searchPath });
			return none;
		}
		if (result.exitCode !== 0 && result.exitCode !== 1) {
			// exit code 1 = no matches (normal), other = error
			logger.error("Remote grep failed", undefined, {
				nodeId,
				exitCode: result.exitCode,
				stderr: result.stderr,
			});
			return none;
		}

		// One file past the cap tells that the listing was cut.
		const listing = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(result.stdout, "base64"));
		const listed = listing.split("\0").slice(0, -1);
		const truncated = listed.length > MAX_RESULTS;
		const rootPrefix = remoteRoot.endsWith("/") ? remoteRoot : remoteRoot + "/";
		const searchPrefix = remoteSearchPath.endsWith("/") ? remoteSearchPath : remoteSearchPath + "/";
		const matchedFiles = listed.slice(0, MAX_RESULTS).filter((filePath) => {
			if (!filePath.startsWith(searchPrefix) || /[\r\n]/.test(filePath)) return false;
			const relative = filePath.slice(rootPrefix.length);
			try {
				return normalizeRemoteRelativePath(relative) === relative;
			} catch {
				return false;
			}
		});

		if (matchedFiles.length === 0) return { results: [], truncated };

		// Drop recycle-bin matches before fetching snippets over SSH so deleted
		// files are neither read again nor surfaced in the batch command.
		const deletedSet = await deletedAmong(matchedFiles.map((filePath) => filePath.slice(rootPrefix.length)));
		const liveMatchedFiles = deletedSet.size > 0
			? matchedFiles.filter((filePath) => !deletedSet.has(filePath.slice(rootPrefix.length)))
			: matchedFiles;
		if (liveMatchedFiles.length === 0) return { results: [], truncated };

		// For each matched file, fetch matching lines with context in ONE
		// remote command — one grep per file meant one sequential SSH exec per
		// result (up to 20 round-trips per search on the node).
		// Every listed file gets its snippets: only the first 20 used to, and
		// the other matches were dropped without a word.
		const results: ContentSearchResult[] = [];
		const batch = liveMatchedFiles;

		if (batch.length > 0) {
			// -H prefixes every match line with its filename so a single grep
			// run covers the whole batch and lines can be attributed back.
			const snippetCmd = `grep -HnIFZ --max-count=${MAX_SNIPPETS_PER_FILE} -- ${shellQuote(sanitizedQuery)} ${batch
				.map((filePath) => shellQuote(filePath))
				.join(" ")} 2>/dev/null | head -${batch.length * MAX_SNIPPETS_PER_FILE} | base64`;
			let snippetLines: string[] = [];
			try {
				const snippetResult = await execRemoteCommand({
					...sshParams,
					command: snippetCmd,
					timeout: 15_000,
				});
				snippetLines = Buffer.from(snippetResult.stdout, "base64").toString("utf8").split("\n");
			} catch {
				// Whole-batch transport failure: report nothing rather than
				// falling back to the per-file exec storm.
				return none;
			}

			for (const filePath of batch) {
				const linePrefix = `${filePath}\0`;
				const snippets = snippetLines
					.filter((line) => line.startsWith(linePrefix))
					.map((line) => truncateSnippet(line.slice(linePrefix.length)))
					.slice(0, MAX_SNIPPETS_PER_FILE);

				if (snippets.length > 0) {
					results.push({
						filePath,
						relativePath: filePath.slice(rootPrefix.length),
						nodeId,
						nodeName,
						nodeDriver: "SFTP",
						snippets,
					});
				}
			}
		}

		return { results, truncated };
	} catch (err) {
		logger.error("SFTP content search SSH error", err, { nodeId });
		return none;
	}
}

/**
 * Unified content search entry point.
 */
export async function searchFileContents(params: {
	query: string;
	nodeId?: string;
	searchPath?: string;
	/** Multi-tenant: limit nodes to caller's team (legacy null still visible). */
	session?: ContentSearchSession | null;
}): Promise<ContentSearchResponse> {
	const { query, nodeId, searchPath, session } = params;

	if (!query.trim()) {
		return { results: [], totalMatches: 0, truncated: false };
	}

	// Fetch storage nodes — always apply team scope when session is present.
	const teamFilter = session ? teamWhere(session) : {};
	const nodes = await prisma.storageNode.findMany({
		where: {
			...(nodeId ? { id: nodeId } : {}),
			...teamFilter,
		},
		select: {
			id: true,
			name: true,
			driver: true,
			basePath: true,
			teamId: true,
		},
	});

	const insensitiveNodes = new Set(nodes.filter(node => hasCaseInsensitiveLocalPaths(node.driver)).map(node => node.id));
	const pathKey = (nodeId: string, path: string) => insensitiveNodes.has(nodeId) ? path.toLowerCase() : path;
	const allResults: ContentSearchResult[] = [];
	let nodeTruncated = false;

	for (const node of nodes) {
		try {
			const relativePath = node.driver === "SFTP" ? normalizeRemoteRelativePath(searchPath) : searchPath ?? "";
			// Path-level ACL: teamWhere only scopes nodes; grants may restrict prefixes.
			if (session) {
				const access = await assertStorageAccess({
					session: session as SessionPayload,
					storageNodeId: node.id,
					relativePath,
					operation: "read",
				});
				if (!access.allowed) {
					continue;
				}
			}
			const deletedAmongForNode = async (relativePaths: string[]) => {
				if (relativePaths.length === 0) return new Set<string>();
				const rows = await prisma.fileEntry.findMany({
					where: { storageNodeId: node.id, isDeleted: true, relativePath: { in: [...new Set(relativePaths.flatMap(indexedAncestors))], ...(insensitiveNodes.has(node.id) && { mode: "insensitive" }) } },
					select: { relativePath: true },
				});
				const hidden = new Set(rows.map(row => pathKey(node.id, row.relativePath)));
				return new Set(relativePaths.filter(path => indexedAncestors(path).some(parent => hidden.has(pathKey(node.id, parent)))));
			};
			if (node.driver === "LOCAL") {
				const local = await searchLocalNode(
					node.id,
					node.name,
					node.basePath,
					query,
					relativePath,
					deletedAmongForNode,
				);
				allResults.push(...local.results);
				nodeTruncated ||= local.truncated;
			} else if (node.driver === "SFTP") {
				const sftp = await searchSftpNode(
					node,
					query,
					relativePath,
					deletedAmongForNode,
				);
				allResults.push(...sftp.results);
				nodeTruncated ||= sftp.truncated;
			}
		} catch (err) {
			logger.error(`Content search failed for node ${node.name}`, err, {
				nodeId: node.id,
			});
		}
	}

	// Filter soft-deleted (recycle-bin) entries: their bytes are still on
	// disk / on the SFTP host, so a raw grep hits them, but the UI never
	// shows deleted files — surfacing their content would leak deleted data.
	// Scope the tombstone lookup to the matched paths and their ancestors on each node this search
	// produced — the previous global scan pulled every tenant's tombstones
	// with no node/team filter and silently truncated at 10k rows, letting
	// deleted content from beyond the cap slip back into results.
	const pathsByNode = new Map<string, Set<string>>();
	for (const result of allResults) {
		const paths = pathsByNode.get(result.nodeId) ?? new Set<string>();
		for (const ancestor of indexedAncestors(result.relativePath)) paths.add(ancestor);
		pathsByNode.set(result.nodeId, paths);
	}
	const tombstoned = new Set<string>();
	if (pathsByNode.size > 0) {
		const rows = await prisma.fileEntry.findMany({
			where: {
				isDeleted: true,
				OR: [...pathsByNode.entries()].map(([nodeId, paths]) => ({
					storageNodeId: nodeId,
					relativePath: { in: [...paths], ...(insensitiveNodes.has(nodeId) && { mode: "insensitive" as const }) },
				})),
			},
			select: { storageNodeId: true, relativePath: true },
		});
		for (const row of rows) {
			tombstoned.add(`${row.storageNodeId}\0${pathKey(row.storageNodeId, row.relativePath)}`);
		}
	}
	const visibleResults = allResults.filter(
		(result) => !indexedAncestors(result.relativePath).some(path => tombstoned.has(`${result.nodeId}\0${pathKey(result.nodeId, path)}`)),
	);

	// Sort: most snippets first
	visibleResults.sort((a, b) => b.snippets.length - a.snippets.length);

	const truncated = nodeTruncated || visibleResults.length > MAX_RESULTS;
	const canSeeBasePath = !session || sessionHasPermission(session as SessionPayload, "storage:manage-node");
	const results = visibleResults.slice(0, MAX_RESULTS).map((item) =>
		canSeeBasePath ? item : { ...item, filePath: item.relativePath },
	);

	return {
		results,
		totalMatches: results.length,
		truncated,
	};
}
