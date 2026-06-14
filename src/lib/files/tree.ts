// TR-039: pure DTO types live in ./dto so client code can reach them
// without pulling the whole server-only service module. We import them
// for in-file use AND re-export them so every existing call site
// 'from "@/lib/files/tree"' keeps working.
import type {
  FileTreeSearchFoldersDto,
  SerializedTreeFolderDto,
  SerializedTreeNodeDto,
  StorageDirectoryForTreeDto,
  StorageEntryForTreeDto,
} from "./dto";

export type {
  FileTreeSearchFoldersDto,
  SerializedTreeFolderDto,
  SerializedTreeNodeDto,
  StorageDirectoryForTreeDto,
  StorageEntryForTreeDto,
};

// Backwards-compatible aliases — existing call sites that imported
// `StorageEntryForTree` / `StorageDirectoryForTree` /
// `SerializedTreeNode` / `SerializedTreeFolder` from this module keep
// working. The DTO form is the canonical name; these aliases stay for
// the transition window only.
export type StorageEntryForTree = StorageEntryForTreeDto;
export type StorageDirectoryForTree = StorageDirectoryForTreeDto;
export type SerializedTreeNode = SerializedTreeNodeDto;
export type SerializedTreeFolder = SerializedTreeFolderDto;

export function isDirectoryEntry(entry: { entryType?: string | null; mimeType?: string | null }) {
	return entry.entryType === "DIRECTORY" || entry.mimeType === "inode/directory";
}

export type FileTreeNode = {
	name: string;
	path: string;
	entryId?: string;
	storageNodeId?: string;
	relativePath?: string;
	folders: Map<string, FileTreeNode>;
	files: StorageEntryForTree[];
	sources: Map<string, string>;
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

export function getStorageNodeGroupKey(node: { id: string; name: string }) {
	return `${node.name}__${node.id.slice(0, 8)}`;
}

export function resolveStorageNodeGroupedPath(
	path: string,
	nodes: Array<{ id: string; name: string; driver: string }>,
) {
	const segments = splitFilePath(path);
	const [firstSegment, ...rest] = segments;
	if (!firstSegment) return null;
	const node = nodes.find((candidate) => getStorageNodeGroupKey(candidate) === firstSegment);
	if (!node) return null;
	return {
		node,
		groupPath: firstSegment,
		remotePath: rest.join("/"),
	};
}

function createNode(name: string, path: string): FileTreeNode {
	return { name, path, folders: new Map(), files: [], sources: new Map() };
}

export function buildFileTree(
	entries: StorageEntryForTree[],
	directories: StorageDirectoryForTree[],
	groupByNode = false,
	nodes: Array<{ id: string; name: string; driver: string }> = [],
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

		for (const node of nodes) {
			if (!nodeGroupMap.has(node.id)) {
				nodeGroupMap.set(node.id, {
					groupKey: getStorageNodeGroupKey(node),
					groupLabel: `${node.name}（${node.driver}）`,
				});
			}
		}

		for (const entry of entries) {
			const nodeId = entry.storageNode.id;
			if (!nodeGroupMap.has(nodeId)) {
				nodeGroupMap.set(nodeId, {
					groupKey: getStorageNodeGroupKey(entry.storageNode),
					groupLabel: `${entry.storageNode.name}（${entry.storageNode.driver}）`,
				});
			}
		}

		for (const directory of directories) {
			const nodeId = directory.storageNodeId;
			if (!nodeGroupMap.has(nodeId)) {
				nodeGroupMap.set(nodeId, {
					groupKey: getStorageNodeGroupKey({ id: directory.storageNodeId, name: directory.storageNodeName }),
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
			const directoryNode = ensureFolder(`${group.groupKey}/${directory.path}`, {
				id: directory.storageNodeId,
				label: `${directory.storageNodeName}（${directory.storageNodeDriver}）`,
			});
			directoryNode.storageNodeId = directory.storageNodeId;
			directoryNode.relativePath = directory.path;
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

			if (isDirectoryEntry(entry)) {
				const directoryNode = ensureFolder([group.groupKey, ...segments].join("/"), source);
				directoryNode.sources.set(source.id, source.label);
				directoryNode.entryId = entry.id;
				directoryNode.storageNodeId = entry.storageNode.id;
				directoryNode.relativePath = entry.relativePath;
			} else {
				cursor.files.push(entry);
				cursor.sources.set(source.id, source.label);
			}
		}
	} else {
		for (const directory of directories) {
			const directoryNode = ensureFolder(directory.path, {
				id: directory.storageNodeId,
				label: `${directory.storageNodeName}（${directory.storageNodeDriver}）`,
			});
			directoryNode.storageNodeId = directory.storageNodeId;
			directoryNode.relativePath = directory.path;
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

			if (isDirectoryEntry(entry)) {
				const directoryNode = ensureFolder(segments.join("/"), source);
				directoryNode.sources.set(source.id, source.label);
				directoryNode.entryId = entry.id;
				directoryNode.storageNodeId = entry.storageNode.id;
				directoryNode.relativePath = entry.relativePath;
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

function getDeepFileCount(node: FileTreeNode): number {
	let total = node.files.length;
	for (const child of node.folders.values()) total += getDeepFileCount(child);
	return total;
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
			storageNodeId: child.storageNodeId ?? null,
			relativePath: child.relativePath ?? null,
			fileCount: getDeepFileCount(child),
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
		if (folder.name!.toLowerCase().includes(normalizedQuery) || getFileTreeDisplayName(folder)!.toLowerCase().includes(normalizedQuery)) {
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
		storageNodeId: node.storageNodeId ?? null,
		relativePath: node.relativePath ?? null,
		fileCount: getDeepFileCount(node),
		folderCount: node.folders.size,
		sourceKeys: [...node.sources.keys()],
		sourceValues: [...node.sources.values()],
	};
}
