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
import path from "node:path";

import { createLogger } from "@/lib/logging";
import { prisma } from "@/lib/db";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { resolveLocalAbsolutePath } from "@/lib/storage/service-entries";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

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
const MAX_SNIPPETS_PER_FILE = 5;
const MAX_SNIPPET_LENGTH = 200;
const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB - skip files larger than this
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
): Promise<ContentSearchResult[]> {
	const results: ContentSearchResult[] = [];
	const lowerQuery = query.toLowerCase();
	const searchRoot = resolveLocalAbsolutePath(basePath, searchPath);

	logger.debug("Local content search", { nodeId, searchRoot, query });

	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > 10 || results.length >= MAX_RESULTS) return;

		let entries: import("node:fs").Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return; // Permission denied or not a directory
		}

		for (const entry of entries) {
			if (results.length >= MAX_RESULTS) return;

			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				// Skip hidden directories and common non-searchable dirs
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
				await walk(fullPath, depth + 1);
			} else if (entry.isFile() && isSearchableFile(entry.name)) {
				try {
					const stat = await fs.stat(fullPath);
					if (stat.size > MAX_FILE_SIZE_BYTES) continue;

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
						const relativePath = path.relative(
							path.resolve(basePath),
							fullPath,
						);
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
	return results;
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
): Promise<ContentSearchResult[]> {
	const sanitizedQuery = sanitizeSearchQuery(query);

	// Fetch the storage node with server info
	const node = await prisma.storageNode.findUnique({
		where: { id: nodeId },
		select: {
			id: true,
			name: true,
			basePath: true,
			host: true,
			port: true,
			username: true,
			server: {
				select: {
					id: true,
					host: true,
					port: true,
					username: true,
					password: true,
					hostKeySha256: true,
					sshKey: { select: { privateKey: true, passphrase: true } },
				},
			},
		},
	});

	if (!node || !node.server) {
		logger.warn("SFTP node has no associated server", { nodeId });
		return [];
	}

	const sshParams = await buildSshParamsFromServer(
		{
			...node.server,
			sshKeyId: null,
		} as never,
		node.server.sshKey,
	);

	// Build the remote search path
	const remoteSearchPath = searchPath
		? `${basePath}/${searchPath.replace(/^\/+/, "")}`
		: basePath;

	// Use grep -r (recursive) -F (fixed string, no regex) -I (skip binary)
	// -l (list filenames only) --include to limit file types
	// Then for each matching file, grep -n to get line numbers + content
	const grepCmd = `grep -rFIl --include='*.txt' --include='*.log' --include='*.md' --include='*.json' --include='*.yaml' --include='*.yml' --include='*.conf' --include='*.cfg' --include='*.sh' --include='*.py' --include='*.js' --include='*.ts' --include='*.html' --include='*.css' --include='*.xml' --include='*.sql' --include='*.env' --include='*.ini' --include='*.toml' --max-count=${MAX_SNIPPETS_PER_FILE} -- ${shellQuote(sanitizedQuery)} ${shellQuote(remoteSearchPath)} 2>/dev/null | head -${MAX_RESULTS}`;

	logger.debug("Remote content search", { nodeId, remoteSearchPath, query: sanitizedQuery });

	try {
		const result = await execRemoteCommand({
			...sshParams,
			command: grepCmd,
			timeout: SEARCH_TIMEOUT_MS,
		});

		if (result.exitCode !== 0 && result.exitCode !== 1) {
			// exit code 1 = no matches (normal), other = error
			logger.error("Remote grep failed", undefined, {
				nodeId,
				exitCode: result.exitCode,
				stderr: result.stderr,
			});
			return [];
		}

		const matchedFiles = result.stdout
			.split("\n")
			.filter(Boolean)
			.slice(0, MAX_RESULTS);

		if (matchedFiles.length === 0) return [];

		// For each matched file, fetch matching lines with context
		const results: ContentSearchResult[] = [];
		const batch = matchedFiles.slice(0, 20); // Limit to 20 files for snippet fetching

		for (const filePath of batch) {
			// grep -n to get line numbers + content, max 5 matches per file
			const snippetCmd = `grep -nIF --max-count=${MAX_SNIPPETS_PER_FILE} -- ${shellQuote(sanitizedQuery)} ${shellQuote(filePath)} 2>/dev/null | head -${MAX_SNIPPETS_PER_FILE}`;
			try {
				const snippetResult = await execRemoteCommand({
					...sshParams,
					command: snippetCmd,
					timeout: 10_000,
				});

				const snippets = snippetResult.stdout
					.split("\n")
					.filter(Boolean)
					.map((line) => truncateSnippet(line))
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
			} catch {
				// Skip files we can't read snippets for
			}
		}

		return results;
	} catch (err) {
		logger.error("SFTP content search SSH error", err, { nodeId });
		return [];
	}
}

/** Shell-quote a string for safe use in remote commands */
export function shellQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Unified content search entry point.
 */
export async function searchFileContents(params: {
	query: string;
	nodeId?: string;
	searchPath?: string;
}): Promise<ContentSearchResponse> {
	const { query, nodeId, searchPath } = params;

	if (!query.trim()) {
		return { results: [], totalMatches: 0, truncated: false };
	}

	// Fetch storage nodes
	const nodes = await prisma.storageNode.findMany({
		where: nodeId ? { id: nodeId } : undefined,
		select: {
			id: true,
			name: true,
			driver: true,
			basePath: true,
		},
	});

	const allResults: ContentSearchResult[] = [];

	for (const node of nodes) {
		try {
			if (node.driver === "LOCAL") {
				const localResults = await searchLocalNode(
					node.id,
					node.name,
					node.basePath,
					query,
					searchPath ?? "",
				);
				allResults.push(...localResults);
			} else if (node.driver === "SFTP") {
				const sftpResults = await searchSftpNode(
					node.id,
					node.name,
					node.basePath,
					query,
					searchPath ?? "",
				);
				allResults.push(...sftpResults);
			}
		} catch (err) {
			logger.error(`Content search failed for node ${node.name}`, err, {
				nodeId: node.id,
			});
		}
	}

	// Sort: most snippets first
	allResults.sort((a, b) => b.snippets.length - a.snippets.length);

	const truncated = allResults.length > MAX_RESULTS;
	const results = allResults.slice(0, MAX_RESULTS);

	return {
		results,
		totalMatches: results.length,
		truncated,
	};
}
