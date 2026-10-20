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
import { getRuntimeSettingNumberCached } from "@/lib/runtime-settings/cached";
import path from "node:path";

import { createLogger } from "@/lib/logging";
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
import { SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { resolveLocalAbsolutePath } from "@/lib/storage/service-entries";
import { expandStorageBasePath } from "@/lib/storage/path-utils";

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

function isSearchableFile(filename: string): boolean {
	const lower = filename.toLowerCase();
	const ext = path.extname(lower);
	if (ext && SEARCHABLE_EXTENSIONS.has(ext)) return true;
	if (!ext && SEARCHABLE_NO_EXT_NAMES.has(lower)) return true;
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

	async function walk(dir: string, depth: number): Promise<void> {
		if (results.length > MAX_RESULTS) return;
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
			if (results.length > MAX_RESULTS) return;

			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				// Skip hidden directories and common non-searchable dirs
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
				await walk(fullPath, depth + 1);
			} else if (entry.isFile() && isSearchableFile(entry.name)) {
				try {
					const stat = await fs.stat(fullPath);
					if (stat.size > maxFileSizeBytes()) continue;

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
						const relativePath = path.relative(nodeRoot, fullPath);
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
	return { results: results.slice(0, MAX_RESULTS), truncated: truncated || results.length > MAX_RESULTS };
}

/**
 * Search SFTP storage node by executing `grep -rlF` on the remote server.
 */
async function searchSftpNode(
	nodeId: string,
	nodeName: string,
	basePath: string,
	query: string,
	searchPath: string,
): Promise<NodeSearchOutcome> {
	const none: NodeSearchOutcome = { results: [], truncated: false };
	const sanitizedQuery = sanitizeSearchQuery(query);

	// The node as file operations load it (sftp-node.ts): its own endpoint
	// overrides, the server's credentials and how it is managed. Built from
	// the server alone with no key id and no connection type, a key-based
	// server was treated as a password one without a password, so every
	// search of it failed and returned nothing; overrides and Agent-managed
	// servers were ignored too.
	const node = await prisma.storageNode.findUnique({
		where: { id: nodeId },
		select: {
			id: true,
			name: true,
			basePath: true,
			host: true,
			port: true,
			username: true,
			hostKeySha256: true,
			server: {
				select: {
					id: true,
					operatingSystem: true,
					host: true,
					port: true,
					username: true,
					connectionType: true,
					managementMode: true,
					password: true,
					hostKeySha256: true,
					sshKey: { select: SSH_KEY_CREDENTIAL_SELECT },
				},
			},
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

	// Build the remote search path — validate against path traversal
	const sanitizedSearchPath = (searchPath || "").replace(/^\/+/, "");
	if (sanitizedSearchPath.includes("..")) {
		logger.warn("SFTP content search rejected: path traversal detected", { nodeId, searchPath });
		return none;
	}
	const remoteSearchPath = sanitizedSearchPath
		? `${basePath}/${sanitizedSearchPath}`
		: basePath;

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
	const relativeSearchPath = path.posix.normalize(sanitizedSearchPath || ".").replace(/\/+$/, "");
	const containment = [
		`root=$(cd -P -- ${shellQuote(basePath)} 2>/dev/null && pwd -P) || exit 2`,
		`target=$(cd -P -- ${shellQuote(remoteSearchPath)} 2>/dev/null && pwd -P) || exit 2`,
		`expected="\${root%/}"${relativeSearchPath === "." ? "" : shellQuote(`/${relativeSearchPath}`)}`,
		'[ "$target" = "${expected:-/}" ] || exit 3',
	].join("\n");
	const grepCmd = `${containment}\ngrep -rFIl --include='*.txt' --include='*.log' --include='*.md' --include='*.json' --include='*.yaml' --include='*.yml' --include='*.toml' --include='*.ini' --include='*.cfg' --include='*.conf' --include='*.env' --include='*.sh' --include='*.bash' --include='*.py' --include='*.js' --include='*.ts' --include='*.jsx' --include='*.tsx' --include='*.html' --include='*.css' --include='*.scss' --include='*.xml' --include='*.sql' --include='*.csv' --include='*.tsv' --include='*.go' --include='*.rs' --include='*.java' --include='*.c' --include='*.cpp' --include='*.h' --include='*.hpp' --include='*.rb' --include='*.php' --include='*.pl' --include='*.swift' --include='*.kt' --include='*.scala' --include='*.lua' --include='*.r' --include='*.vue' --include='*.svelte' --include='*.properties' --max-count=${MAX_SNIPPETS_PER_FILE} -- ${shellQuote(sanitizedQuery)} ${shellQuote(remoteSearchPath)} 2>/dev/null | head -${MAX_RESULTS + 1}`;

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
		const listed = result.stdout.split("\n").filter(Boolean);
		const truncated = listed.length > MAX_RESULTS;
		const matchedFiles = listed.slice(0, MAX_RESULTS);

		if (matchedFiles.length === 0) return none;

		// For each matched file, fetch matching lines with context in ONE
		// remote command — one grep per file meant one sequential SSH exec per
		// result (up to 20 round-trips per search on the node).
		// Every listed file gets its snippets: only the first 20 used to, and
		// the other matches were dropped without a word.
		const results: ContentSearchResult[] = [];
		const batch = matchedFiles;

		if (batch.length > 0) {
			// -H prefixes every match line with its filename so a single grep
			// run covers the whole batch and lines can be attributed back.
			const snippetCmd = `grep -HnIF --max-count=${MAX_SNIPPETS_PER_FILE} -- ${shellQuote(sanitizedQuery)} ${batch
				.map((filePath) => shellQuote(filePath))
				.join(" ")} 2>/dev/null | head -${batch.length * MAX_SNIPPETS_PER_FILE}`;
			let snippetLines: string[] = [];
			try {
				const snippetResult = await execRemoteCommand({
					...sshParams,
					command: snippetCmd,
					timeout: 15_000,
				});
				snippetLines = snippetResult.stdout.split("\n").filter(Boolean);
			} catch {
				// Whole-batch transport failure: report nothing rather than
				// falling back to the per-file exec storm.
				return none;
			}

			for (const filePath of batch) {
				const linePrefix = `${filePath}:`;
				const snippets = snippetLines
					.filter((line) => line.startsWith(linePrefix))
					.map((line) => truncateSnippet(line.slice(linePrefix.length)))
					.slice(0, MAX_SNIPPETS_PER_FILE);

				if (snippets.length > 0) {
					const relativePath = filePath.startsWith(basePath)
						? filePath.slice(basePath.length).replace(/^\/+/, "")
						: filePath;
					results.push({
						filePath,
						relativePath,
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
		},
	});

	const allResults: ContentSearchResult[] = [];
	let nodeTruncated = false;

	for (const node of nodes) {
		try {
			// Path-level ACL: teamWhere only scopes nodes; grants may restrict prefixes.
			if (session) {
				const access = await assertStorageAccess({
					session: session as SessionPayload,
					storageNodeId: node.id,
					relativePath: searchPath ?? "",
					operation: "read",
				});
				if (!access.allowed) {
					continue;
				}
			}
			if (node.driver === "LOCAL") {
				const local = await searchLocalNode(
					node.id,
					node.name,
					node.basePath,
					query,
					searchPath ?? "",
				);
				allResults.push(...local.results);
				nodeTruncated ||= local.truncated;
			} else if (node.driver === "SFTP") {
				const sftp = await searchSftpNode(
					node.id,
					node.name,
					node.basePath,
					query,
					searchPath ?? "",
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
	// Scope the tombstone lookup to the exact (node, path) pairs this search
	// produced — the previous global scan pulled every tenant's tombstones
	// with no node/team filter and silently truncated at 10k rows, letting
	// deleted content from beyond the cap slip back into results.
	const pathsByNode = new Map<string, Set<string>>();
	for (const result of allResults) {
		const paths = pathsByNode.get(result.nodeId) ?? new Set<string>();
		paths.add(result.relativePath);
		pathsByNode.set(result.nodeId, paths);
	}
	const tombstoned = new Set<string>();
	if (pathsByNode.size > 0) {
		const rows = await prisma.fileEntry.findMany({
			where: {
				isDeleted: true,
				OR: [...pathsByNode.entries()].map(([nodeId, paths]) => ({
					storageNodeId: nodeId,
					relativePath: { in: [...paths] },
				})),
			},
			select: { storageNodeId: true, relativePath: true },
		});
		for (const row of rows) {
			tombstoned.add(`${row.storageNodeId}\0${row.relativePath}`);
		}
	}
	const visibleResults = allResults.filter(
		(result) => !tombstoned.has(`${result.nodeId}\0${result.relativePath}`),
	);

	// Sort: most snippets first
	visibleResults.sort((a, b) => b.snippets.length - a.snippets.length);

	const truncated = nodeTruncated || visibleResults.length > MAX_RESULTS;
	const results = visibleResults.slice(0, MAX_RESULTS);

	return {
		results,
		totalMatches: results.length,
		truncated,
	};
}
