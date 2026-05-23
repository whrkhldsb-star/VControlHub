import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getStorageOverview } from "@/lib/storage/service";

export const dynamic = "force-dynamic";

type StorageEntry = Awaited<ReturnType<typeof getStorageOverview>>["entries"][number];

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

type FileTreeNode = {
	name: string;
	path: string;
	entryId?: string;
	folders: Map<string, FileTreeNode>;
	files: StorageEntry[];
	sources: Map<string, string>;
};

function buildTree(
	entries: StorageEntry[],
	directories: Awaited<ReturnType<typeof getStorageOverview>>["remoteDirectories"],
	groupByNode: boolean = false,
) {
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
		// Group by node: each node gets a top-level folder named "节点名（DRIVER）"
		// Prefix paths with the node group key so entries land under their node folder
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

export async function GET(request: NextRequest) {
	try {
		const session = await requireSession();
		const canEditLocalFiles = sessionHasPermission(session, "storage:write");
		const canDelete = sessionHasPermission(session, "storage:delete");
		const canManageNodes = sessionHasPermission(session, "storage:manage-node");

		const searchParams = request.nextUrl.searchParams;
		const currentPath = normalizePath(searchParams.get("path") ?? undefined);
		const searchQuery = (searchParams.get("q") ?? "").trim();
		const searchScope = searchParams.get("scope") === "all" ? "all" : "current";
		const nodeIdFilter = searchParams.get("nodeId") ?? "";

		const storage = await getStorageOverview();

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

		// Apply search filter
		if (searchQuery) {
			const lowerQuery = searchQuery.toLowerCase();
			if (searchScope === "all") {
				// For "all" search, we need recursive search
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

		// Serialize tree for client (convert Maps to arrays)
		interface SerializedTreeNode {
			name: string; displayName?: string; path: string; entryId: string | null;
			fileCount: number; folderCount: number; sourceKeys: string[]; sourceValues: string[];
			children: SerializedTreeNode[];
		}

		function serializeTreeNode(node: FileTreeNode, depth = 0): SerializedTreeNode[] {
			if (depth > 10) return []; // safety limit
			const children = [...node.folders.values()]
				.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
				.map((child) => {
					// For node-group folders (name contains "__"), use sourceValues as display name
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

		const sourceSummary = [...currentNode.sources.values()];
		const totalItems = folders.length + files.length;

		return NextResponse.json({
			currentPath,
			nodeIdFilter,
			folders: folders.map((f) => {
				// For node-group folders (name contains "__"), use sourceValues as display name
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
				directAccessFallbackHref: "fallbackHref" in entry.directAccess ? entry.directAccess.fallbackHref : null,
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
			searchScope,
			permissions: {
				canEditLocalFiles,
				canDelete,
				canManageNodes,
			},
			nodes: storage.nodes.map((n) => ({ id: n.id, name: n.name, driver: n.driver })),
		});
	} catch (error) {
		if (error instanceof Error && error.message.includes("Unauthorized")) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Internal server error" },
			{ status: 500 },
		);
	}
}
