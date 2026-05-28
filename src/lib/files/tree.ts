import type { getStorageOverview } from "@/lib/storage/service";

export type StorageEntryForTree = Awaited<ReturnType<typeof getStorageOverview>>["entries"][number];
export type StorageDirectoryForTree = Awaited<ReturnType<typeof getStorageOverview>>["remoteDirectories"][number];

export type FileTreeNode = {
	name: string;
	path: string;
	entryId?: string;
	folders: Map<string, FileTreeNode>;
	files: StorageEntryForTree[];
	sources: Map<string, string>;
};

export type SerializedTreeNode = {
	name: string;
	displayName?: string;
	path: string;
	entryId: string | null;
	fileCount: number;
	folderCount: number;
	sourceKeys: string[];
	sourceValues: string[];
	children: SerializedTreeNode[];
};

export function normalizeFilePath(value?: string | null) {
	return (value ?? "")
		.replace(/\\/g, "/")
		.split("/")
		.map((segment) => segment.trim())
		.filter(Boolean)
		.join("/");
}

export function splitFilePath(path: string) {
	return path ? path.split("/").filter(Boolean) : [];
}

function createNode(name: string, path: string): FileTreeNode {
	return { name, path, folders: new Map(), files: [], sources: new Map() };
}

export function buildFileTree(
	entries: StorageEntryForTree[],
	directories: StorageDirectoryForTree[],
	groupByNode = false,
) {
	const root = createNode("全部文件", "");

	const ensureFolder = (targetPath: string, source?: { id: string; label: string }) => {
		const segments = splitFilePath(targetPath);
		let cursor = root;

		for (const [index, segment] of segments.entries()) {
			const nextPath = segments.slice(0, index + 1).join("/");
			if (!cursor.folders.has(segment)) {
				cursor.folders.set(segment, createNode(segment, nextPath));
			}
			cursor = cursor.folders.get(segment)!;
			if (source) cursor.sources.set(source.id, source.label);
		}

		return cursor;
	};

	if (groupByNode) {
		const nodeGroupMap = new Map<string, { groupKey: string; groupLabel: string }>();

		for (const entry of entries) {
			const nodeId = entry.storageNode.id;
			if (!nodeGroupMap.has(nodeId)) {
				nodeGroupMap.set(nodeId, {
					groupKey: `${entry.storageNode.name}__${entry.storageNode.id.slice(0, 8)}`,
					groupLabel: `${entry.storageNode.name}（${entry.storageNode.driver}）`,
				});
			}
		}

		for (const directory of directories) {
			const nodeId = directory.storageNodeId;
			if (!nodeGroupMap.has(nodeId)) {
				nodeGroupMap.set(nodeId, {
					groupKey: `${directory.storageNodeName}__${directory.storageNodeId.slice(0, 8)}`,
					groupLabel: `${directory.storageNodeName}（${directory.storageNodeDriver}）`,
				});
			}
		}

		for (const [nodeId, { groupKey, groupLabel }] of nodeGroupMap) {
			ensureFolder(groupKey, { id: nodeId, label: groupLabel });
		}

		for (const directory of directories) {
			const group = nodeGroupMap.get(directory.storageNodeId);
			if (!group) continue;
			ensureFolder(`${group.groupKey}/${directory.path}`, {
				id: directory.storageNodeId,
				label: `${directory.storageNodeName}（${directory.storageNodeDriver}）`,
			});
		}

		for (const entry of entries) {
			const segments = splitFilePath(entry.relativePath);
			if (segments.length === 0) continue;

			const group = nodeGroupMap.get(entry.storageNode.id);
			if (!group) continue;
			const source = { id: entry.storageNode.id, label: `${entry.storageNode.name}（${entry.storageNode.driver}）` };

			const nodeFolder = root.folders.get(group.groupKey);
			if (!nodeFolder) continue;
			let cursor = nodeFolder;
			cursor.sources.set(source.id, source.label);

			const parentSegments = segments.slice(0, -1);
			for (const [index, segment] of parentSegments.entries()) {
				const nextPath = [group.groupKey, ...parentSegments.slice(0, index + 1)].join("/");
				if (!cursor.folders.has(segment)) {
					cursor.folders.set(segment, createNode(segment, nextPath));
				}
				cursor = cursor.folders.get(segment)!;
				cursor.sources.set(source.id, source.label);
			}

			if (entry.mimeType === "inode/directory" || entry.entryType === "DIRECTORY") {
				const directoryNode = ensureFolder([group.groupKey, ...segments].join("/"), source);
				directoryNode.sources.set(source.id, source.label);
				directoryNode.entryId = entry.id;
			} else {
				cursor.files.push(entry);
				cursor.sources.set(source.id, source.label);
			}
		}
	} else {
		for (const directory of directories) {
			ensureFolder(directory.path, {
				id: directory.storageNodeId,
				label: `${directory.storageNodeName}（${directory.storageNodeDriver}）`,
			});
		}

		for (const entry of entries) {
			const segments = splitFilePath(entry.relativePath);
			if (segments.length === 0) continue;

			const source = { id: entry.storageNode.id, label: `${entry.storageNode.name}（${entry.storageNode.driver}）` };
			let cursor = root;
			const parentSegments = segments.slice(0, -1);

			for (const [index, segment] of parentSegments.entries()) {
				const nextPath = parentSegments.slice(0, index + 1).join("/");
				if (!cursor.folders.has(segment)) {
					cursor.folders.set(segment, createNode(segment, nextPath));
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

export function findFileTreeNode(root: FileTreeNode, targetPath: string) {
	const segments = splitFilePath(targetPath);
	let cursor = root;

	for (const segment of segments) {
		const next = cursor.folders.get(segment);
		if (!next) return null;
		cursor = next;
	}

	return cursor;
}

export function getFileTreeDisplayName(node: FileTreeNode) {
	return node.name.includes("__") && node.sources.size === 1 ? [...node.sources.values()][0] : node.name;
}

export function serializeFileTreeNode(node: FileTreeNode, depth = 0): SerializedTreeNode[] {
	if (depth > 10) return [];

	return [...node.folders.values()]
		.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
		.map((child) => ({
			name: child.name,
			displayName: getFileTreeDisplayName(child),
			path: child.path,
			entryId: child.entryId ?? null,
			fileCount: child.files.length,
			folderCount: child.folders.size,
			sourceKeys: [...child.sources.keys()],
			sourceValues: [...child.sources.values()],
			children: serializeFileTreeNode(child, depth + 1),
		}));
}

export function searchFileTree(root: FileTreeNode, query: string): { folders: FileTreeNode[]; files: StorageEntryForTree[] } {
	const normalizedQuery = query.toLowerCase();
	const matchedFolders: FileTreeNode[] = [];
	const matchedFiles: StorageEntryForTree[] = [];

	for (const folder of root.folders.values()) {
		if (folder.name.toLowerCase().includes(normalizedQuery) || getFileTreeDisplayName(folder).toLowerCase().includes(normalizedQuery)) {
			matchedFolders.push(folder);
		}
		const subResults = searchFileTree(folder, query);
		matchedFolders.push(...subResults.folders);
		matchedFiles.push(...subResults.files);
	}

	for (const file of root.files) {
		if (file.name.toLowerCase().includes(normalizedQuery)) {
			matchedFiles.push(file);
		}
	}

	return { folders: matchedFolders, files: matchedFiles };
}

export function serializeFileTreeFolder(node: FileTreeNode) {
	return {
		name: node.name,
		displayName: getFileTreeDisplayName(node),
		path: node.path,
		entryId: node.entryId ?? null,
		fileCount: node.files.length,
		folderCount: node.folders.size,
		sourceKeys: [...node.sources.keys()],
		sourceValues: [...node.sources.values()],
	};
}
