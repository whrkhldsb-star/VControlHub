import Link from "next/link";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getStorageOverview } from "@/lib/storage/service";

import { getStorageFormOptions } from "@/app/storage/actions";
import { FilesBrowserSpa } from "./files-browser-spa";
import { PageShell } from "@/components/page-shell";
import { StorageNodeManager } from "./storage-node-manager";

type StorageDirectory = Awaited<ReturnType<typeof getStorageOverview>>["remoteDirectories"][number];

export const dynamic = "force-dynamic";

type FilesPageProps = {
	searchParams?: Promise<{ path?: string; q?: string; tab?: string; scope?: string; nodeId?: string }>;
};

function normalizePath(value?: string) {
	return (value ?? "")
		.replace(/\\/g, "/")
		.split("/")
		.map((segment) => segment.trim())
		.filter(Boolean)
		.join("/");
}

function splitPath(path: string) {
	return path ? path.split("/").filter(Boolean) : [];
}

/* ── Tree building (server-side, for initial data passed to API response builder) ── */

type StorageEntry = Awaited<ReturnType<typeof getStorageOverview>>["entries"][number];

type FileTreeNode = {
	name: string;
	path: string;
	entryId?: string;
	folders: Map<string, FileTreeNode>;
	files: StorageEntry[];
	sources: Map<string, string>;
};

function buildTree(entries: StorageEntry[], directories: StorageDirectory[], groupByNode: boolean = false) {
	const root: FileTreeNode = { name: "全部文件", path: "", folders: new Map(), files: [], sources: new Map() };

	const ensureFolder = (targetPath: string, source?: { id: string; label: string }) => {
		const segments = splitPath(targetPath);
		let cursor = root;

		for (const [index, segment] of segments.entries()) {
			const nextPath = segments.slice(0, index + 1).join("/");
			if (!cursor.folders.has(segment)) {
				cursor.folders.set(segment, { name: segment, path: nextPath, folders: new Map(), files: [], sources: new Map() });
			}
			cursor = cursor.folders.get(segment)!;
			if (source) {
				cursor.sources.set(source.id, source.label);
			}
		}

		return cursor;
	};

	if (groupByNode) {
		// Group by node: each node gets a top-level folder named "节点名__nodeId"
		const nodeGroupMap = new Map<string, { groupKey: string; groupLabel: string }>();

		for (const entry of entries) {
			const nodeId = entry.storageNode.id;
			if (!nodeGroupMap.has(nodeId)) {
				const groupKey = `${entry.storageNode.name}__${entry.storageNode.id.slice(0, 8)}`;
				const groupLabel = `${entry.storageNode.name}（${entry.storageNode.driver}）`;
				nodeGroupMap.set(nodeId, { groupKey, groupLabel });
			}
		}

		for (const directory of directories) {
			const nodeId = directory.storageNodeId;
			if (!nodeGroupMap.has(nodeId)) {
				const groupKey = `${directory.storageNodeName}__${directory.storageNodeId.slice(0, 8)}`;
				const groupLabel = `${directory.storageNodeName}（${directory.storageNodeDriver}）`;
				nodeGroupMap.set(nodeId, { groupKey, groupLabel });
			}
		}

		// Create node group folders
		for (const [nodeId, { groupKey, groupLabel }] of nodeGroupMap) {
			ensureFolder(groupKey, { id: nodeId, label: groupLabel });
		}

		// Add directories under their node group
		for (const directory of directories) {
			const { groupKey } = nodeGroupMap.get(directory.storageNodeId)!;
			const prefixedPath = `${groupKey}/${directory.path}`;
			ensureFolder(prefixedPath, {
				id: directory.storageNodeId,
				label: `${directory.storageNodeName}（${directory.storageNodeDriver}）`,
			});
		}

		// Add entries under their node group
		for (const entry of entries) {
			const segments = splitPath(entry.relativePath);
			if (segments.length === 0) continue;

			const { groupKey } = nodeGroupMap.get(entry.storageNode.id)!;
			const source = {
				id: entry.storageNode.id,
				label: `${entry.storageNode.name}（${entry.storageNode.driver}）`,
			};

			const nodeFolder = root.folders.get(groupKey)!;
			let cursor = nodeFolder;
			cursor.sources.set(source.id, source.label);

			const parentSegments = segments.slice(0, -1);
			for (const [index, segment] of parentSegments.entries()) {
				const nextPath = [groupKey, ...parentSegments.slice(0, index + 1)].join("/");
				if (!cursor.folders.has(segment)) {
					cursor.folders.set(segment, { name: segment, path: nextPath, folders: new Map(), files: [], sources: new Map() });
				}
				cursor = cursor.folders.get(segment)!;
				cursor.sources.set(source.id, source.label);
			}

			if (entry.mimeType === "inode/directory" || entry.entryType === "DIRECTORY") {
				const dirPath = [groupKey, ...segments].join("/");
				const directoryNode = ensureFolder(dirPath, source);
				directoryNode.sources.set(source.id, source.label);
				directoryNode.entryId = entry.id;
			} else {
				cursor.files.push(entry);
				cursor.sources.set(source.id, source.label);
			}
		}
	} else {
		// Flat mode (single node selected): entries are placed directly under root
		for (const directory of directories) {
			ensureFolder(directory.path, {
				id: directory.storageNodeId,
				label: `${directory.storageNodeName}（${directory.storageNodeDriver}）`,
			});
		}

		for (const entry of entries) {
			const segments = splitPath(entry.relativePath);
			if (segments.length === 0) continue;

			const source = {
				id: entry.storageNode.id,
				label: `${entry.storageNode.name}（${entry.storageNode.driver}）`,
			};

			let cursor = root;
			const parentSegments = segments.slice(0, -1);

			for (const [index, segment] of parentSegments.entries()) {
				const nextPath = parentSegments.slice(0, index + 1).join("/");
				if (!cursor.folders.has(segment)) {
					cursor.folders.set(segment, { name: segment, path: nextPath, folders: new Map(), files: [], sources: new Map() });
				}
				cursor = cursor.folders.get(segment)!;
				cursor.sources.set(source.id, source.label);
			}

			if (entry.mimeType === "inode/directory" || entry.entryType === "DIRECTORY") {
				const directoryNode = ensureFolder(segments.join("/"), source);
				directoryNode.sources.set(source.id, source.label);
				directoryNode.entryId = entry.id;
			} else {
				cursor.files.push(entry);
				cursor.sources.set(source.id, source.label);
			}
		}
	}

	return root;
}

function findTreeNode(root: FileTreeNode, targetPath: string) {
	const segments = splitPath(targetPath);
	let cursor = root;

	for (const segment of segments) {
		const next = cursor.folders.get(segment);
		if (!next) {
			return null;
		}
		cursor = next;
	}

	return cursor;
}

interface SerializedTreeNode {
	name: string; displayName?: string; path: string; entryId: string | null;
	fileCount: number; folderCount: number; sourceKeys: string[]; sourceValues: string[];
	children: SerializedTreeNode[];
}

function serializeTreeNode(node: FileTreeNode, depth = 0): SerializedTreeNode[] {
	if (depth > 10) return [];
	const children = [...node.folders.values()]
		.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
		.map((child) => {
			const isNodeGroup = child.name.includes("__") && child.sources.size === 1;
			const displayName = isNodeGroup
				? [...child.sources.values()][0]
				: child.name;
			return {
				name: child.name,
				displayName,
				path: child.path,
				entryId: child.entryId ?? null,
				fileCount: child.files.length,
				folderCount: child.folders.size,
				sourceKeys: [...child.sources.keys()],
				sourceValues: [...child.sources.values()],
				children: serializeTreeNode(child, depth + 1),
			};
		});
	return children;
}

export default async function FilesPage({ searchParams }: FilesPageProps) {
	const session = await requireSession("/files");
	const canEditLocalFiles = sessionHasPermission(session, "storage:write");
	const canDelete = sessionHasPermission(session, "storage:delete");
	const canManageNodes = sessionHasPermission(session, "storage:manage-node");
	const resolvedSearchParams = (await searchParams) ?? {};
	const currentPath = normalizePath(resolvedSearchParams.path);
	const searchQuery = (resolvedSearchParams.q ?? "").trim();
	const searchScope = resolvedSearchParams.scope === "all" ? "all" : "current";
	const nodeIdFilter = resolvedSearchParams.nodeId ?? "";

	const [storage, formOptions] = await Promise.all([
		getStorageOverview(),
		canManageNodes || canEditLocalFiles ? getStorageFormOptions() : Promise.resolve({ servers: [], nodes: [] }),
	]);

	// Filter entries by nodeId if specified
	const filteredEntries = nodeIdFilter
		? storage.entries.filter((e) => e.storageNode.id === nodeIdFilter)
		: storage.entries;
	const filteredDirectories = nodeIdFilter
		? storage.remoteDirectories.filter((d) => d.storageNodeId === nodeIdFilter)
		: storage.remoteDirectories;

	// When no specific node is selected, group entries by node to avoid
	// mixing SFTP root directories with LOCAL directories at root level
	const groupByNode = !nodeIdFilter;
	const tree = buildTree(filteredEntries, filteredDirectories, groupByNode);
	const currentNode = findTreeNode(tree, currentPath) ?? tree;
	let folders = [...currentNode.folders.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
	let files = [...currentNode.files].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

	if (searchQuery) {
		const lowerQuery = searchQuery.toLowerCase();
		if (searchScope === "all") {
			function searchAllNodes(node: FileTreeNode, query: string): { folders: FileTreeNode[]; files: StorageEntry[] } {
				const matchedFolders: FileTreeNode[] = [];
				const matchedFiles: StorageEntry[] = [];

				for (const folder of node.folders.values()) {
					if (folder.name.toLowerCase().includes(query)) {
						matchedFolders.push(folder);
					}
					const subResults = searchAllNodes(folder, query);
					matchedFolders.push(...subResults.folders);
					matchedFiles.push(...subResults.files);
				}

				for (const file of node.files) {
					if (file.name.toLowerCase().includes(query)) {
						matchedFiles.push(file);
					}
				}

				return { folders: matchedFolders, files: matchedFiles };
			}

			const allResults = searchAllNodes(tree, searchQuery);
			folders = allResults.folders;
			files = allResults.files;
		} else {
			folders = folders.filter((f) => f.name.toLowerCase().includes(lowerQuery));
			files = files.filter((e) => e.name.toLowerCase().includes(lowerQuery));
		}
	}

	const totalItems = folders.length + files.length;
	const sourceSummary = [...currentNode.sources.values()];

	// Build initial data for SPA component (same format as API response)
	const initialData = {
		currentPath,
		nodeIdFilter,
		folders: folders.map((f) => {
			const isNodeGroup = f.name.includes("__") && f.sources.size === 1;
			const displayName = isNodeGroup
				? [...f.sources.values()][0]
				: f.name;
			return {
				name: f.name,
				displayName,
				path: f.path,
				entryId: f.entryId ?? null,
				fileCount: f.files.length,
				folderCount: f.folders.size,
				sourceKeys: [...f.sources.keys()],
				sourceValues: [...f.sources.values()],
			};
		}),
		files: files.map((entry) => ({
			id: entry.id,
			name: entry.name,
			entryType: entry.entryType,
			mimeType: entry.mimeType ?? null,
			relativePath: entry.relativePath,
			sizeLabel: entry.sizeLabel,
			previewable: entry.previewable,
			directAccessMode: entry.directAccess.mode,
			directAccessHref: entry.directAccess.href ?? null,
			directAccessDescription: entry.directAccess.description,
			storageNodeId: entry.storageNode.id,
			storageNodeName: entry.storageNode.name,
			storageNodeDriver: entry.storageNode.driver,
			updatedAt: "updatedAt" in entry && entry.updatedAt ? String(entry.updatedAt) : null,
		})),
		tree: {
			name: tree.name,
			path: tree.path,
			children: serializeTreeNode(tree),
		},
		stats: {
			...storage.stats,
			totalItems,
		},
		sourceSummary,
		searchQuery,
		searchScope: searchScope as "current" | "all",
		permissions: {
			canEditLocalFiles,
			canDelete,
			canManageNodes,
		},
		nodes: storage.nodes.map((n) => ({ id: n.id, name: n.name, driver: n.driver })),
	};

	const sftpNodes = storage.nodes.filter((n) => n.driver === "SFTP");

	return (
		<PageShell maxW="max-w-7xl">
				<header className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight text-white">文件与存储管理</h1>
					<p className="mt-1.5 text-sm text-slate-500">文件浏览、上传下载、存储节点管理一体化</p>
				</header>

				<section className="grid gap-3 sm:grid-cols-4 mb-8">
					<article className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors duration-150">
						<div className="text-xs font-medium text-slate-500 uppercase tracking-wider">文件节点</div>
						<div className="mt-1.5 text-2xl font-semibold text-white">{storage.stats.totalNodes}</div>
					</article>
					<article className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors duration-150">
						<div className="text-xs font-medium text-slate-500 uppercase tracking-wider">活跃文件</div>
						<div className="mt-1.5 text-2xl font-semibold text-white">{storage.stats.totalEntries}</div>
					</article>
					<article className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors duration-150">
						<div className="text-xs font-medium text-slate-500 uppercase tracking-wider">当前目录</div>
						<div className="mt-1.5 text-2xl font-semibold text-white">{totalItems}</div>
					</article>
					<article className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors duration-150">
						<div className="text-xs font-medium text-slate-500 uppercase tracking-wider">回收站</div>
					<div className="mt-1.5 text-2xl font-semibold text-white">{storage.stats.deletedEntries}</div>
					</article>
				</section>

				<section className="mb-8 grid gap-3 lg:grid-cols-3">
					<Link href="/files?scope=all" className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4 transition hover:bg-cyan-400/[0.1]">
						<div className="text-sm font-semibold text-white">全局文件搜索</div>
						<p className="mt-1.5 text-sm leading-6 text-slate-300">跨本地和 SFTP 节点搜索文件名，适合快速定位配置、日志和上传文件。</p>
						<div className="mt-3 text-xs text-cyan-200">打开全局搜索</div>
					</Link>
					<Link href="/files?scope=current" className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 transition hover:bg-white/[0.06]">
						<div className="text-sm font-semibold text-white">当前目录检索</div>
						<p className="mt-1.5 text-sm leading-6 text-slate-300">在当前路径内筛选文件名，适合编辑前先缩小范围。</p>
						<div className="mt-3 text-xs text-slate-400">仅当前目录</div>
					</Link>
					<Link href="/files?tab=recycle" className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 transition hover:bg-white/[0.06]">
						<div className="text-sm font-semibold text-white">回收站</div>
						<p className="mt-1.5 text-sm leading-6 text-slate-300">查看最近删除的文件，做误删恢复前的快速核对。</p>
						<div className="mt-3 text-xs text-slate-400">进入回收站</div>
					</Link>
				</section>

				<StorageNodeManager
					nodes={storage.nodes}
					servers={formOptions.servers}
					canManageNodes={canManageNodes}
				/>

				<FilesBrowserSpa
					initialData={initialData}
					deletedEntries={storage.deletedEntries.map((d) => ({
						id: d.id,
						name: d.name,
						entryType: d.entryType,
						relativePath: d.relativePath,
						size: d.size,
					}))}
					sftpNodes={sftpNodes.map((n) => ({
						id: n.id,
						name: n.name,
						driver: n.driver,
						serverId: n.serverId ?? null,
						serverName: n.server?.name ?? null,
					}))}
				/>
		</PageShell>
	);
}
