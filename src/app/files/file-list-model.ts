import type { FileProp } from "./file-entry-utils";

export type FolderProp = {
	name: string;
	displayName?: string;
	path: string;
	entryId?: string | null;
	storageNodeId?: string | null;
	relativePath?: string | null;
	capabilities?: FileProp["capabilities"];
	fileCount: number;
	folderCount: number;
	sourceKeys: string[];
	sourceValues: string[];
};

export type FileListSortKey = "name" | "size" | "source" | "updated";
export type FileListSortDir = "asc" | "desc";

export type FileEntryCapabilityFallbacks = {
	canEditLocalFiles: boolean;
	canDelete: boolean;
};

export function entryCanRead(entry: { capabilities?: FileProp["capabilities"] }) {
	return entry.capabilities?.canRead ?? true;
}

export function entryCanWrite(
	entry: { capabilities?: FileProp["capabilities"] },
	fallbacks: Pick<FileEntryCapabilityFallbacks, "canEditLocalFiles">,
) {
	return entry.capabilities?.canWrite ?? fallbacks.canEditLocalFiles;
}

export function entryCanDelete(
	entry: { capabilities?: FileProp["capabilities"] },
	fallbacks: Pick<FileEntryCapabilityFallbacks, "canDelete">,
) {
	return entry.capabilities?.canDelete ?? fallbacks.canDelete;
}

export function folderCanWrite(
	folder: FolderProp,
	fallbacks: Pick<FileEntryCapabilityFallbacks, "canEditLocalFiles">,
) {
	return folder.capabilities?.canWrite ?? fallbacks.canEditLocalFiles;
}

export function getVisibleFiles(files: FileProp[]) {
	return files.filter(
		(file) => file.entryType !== "DIRECTORY" && file.mimeType !== "inode/directory",
	);
}

export function getSelectableFiles(
	files: FileProp[],
	fallbacks: FileEntryCapabilityFallbacks,
) {
	return files.filter(
		(file) => entryCanWrite(file, fallbacks) || entryCanDelete(file, fallbacks),
	);
}

export function sortFolders(
	folders: FolderProp[],
	sortKey: FileListSortKey,
	sortDir: FileListSortDir,
) {
	const sorted = [...folders];
	if (sortKey === "name") {
		sorted.sort((a, b) =>
			(a.displayName ?? a.name).localeCompare(b.displayName ?? b.name),
		);
	}
	if (sortDir === "desc") sorted.reverse();
	return sorted;
}

export function sortFiles(
	files: FileProp[],
	sortKey: FileListSortKey,
	sortDir: FileListSortDir,
) {
	const sorted = [...files];
	sorted.sort((a, b) => compareFiles(a, b, sortKey));
	if (sortDir === "desc") sorted.reverse();
	return sorted;
}

function compareFiles(a: FileProp, b: FileProp, sortKey: FileListSortKey) {
	switch (sortKey) {
		case "name":
			return a.name.localeCompare(b.name);
		case "size":
			return (a.sizeBytes ?? -1) - (b.sizeBytes ?? -1);
		case "source":
			return a.storageNodeName.localeCompare(b.storageNodeName);
		case "updated":
			return (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
		default:
			return 0;
	}
}

export type FileSelectionSummary = {
	effectiveSelectedIds: string[];
	effectiveSelectedIdSet: Set<string>;
	selectedFileEntries: FileProp[];
	selectedCount: number;
	selectedEntriesCanDelete: boolean;
	selectedEntriesCanMove: boolean;
	/** Batch compress is LOCAL-only (server tar). */
	selectedEntriesCanCompress: boolean;
	allSelected: boolean;
	someSelected: boolean;
	selectableFileIds: string[];
};

export function getSelectionSummary({
	visibleFiles,
	selectableFiles,
	selectedIds,
	selectedScopeMatches,
	fallbacks,
}: {
	visibleFiles: FileProp[];
	selectableFiles: FileProp[];
	selectedIds: Set<string>;
	selectedScopeMatches: boolean;
	fallbacks: FileEntryCapabilityFallbacks;
}): FileSelectionSummary {
	const selectableFileIds = selectableFiles.map((file) => file.id);
	const selectableFileIdSet = new Set(selectableFileIds);
	const effectiveSelectedIds = selectedScopeMatches
		? [...selectedIds].filter((id) => selectableFileIdSet.has(id))
		: [];
	const effectiveSelectedIdSet = new Set(effectiveSelectedIds);
	const selectedFileEntries = visibleFiles.filter((file) =>
		effectiveSelectedIdSet.has(file.id),
	);
	const selectedCount = effectiveSelectedIds.length;
	const selectedEntriesCanDelete =
		selectedCount > 0 &&
		selectedFileEntries.every((entry) => entryCanDelete(entry, fallbacks));
	const selectedEntriesCanMove =
		selectedCount > 0 &&
		selectedFileEntries.every((entry) =>
			entryCanWrite(entry, { canEditLocalFiles: fallbacks.canEditLocalFiles }),
		);
	// `/api/files/compress` only supports LOCAL storage nodes. Hide the
	// toolbar action for SFTP (or mixed) selections so the UI does not
	// offer a path that always fails with 400 after the user clicks.
	const selectedEntriesCanCompress =
		selectedEntriesCanMove &&
		selectedFileEntries.every((entry) => entry.storageNodeDriver === "LOCAL");
	const allSelected =
		selectableFiles.length > 0 &&
		selectableFileIds.every((id) => effectiveSelectedIdSet.has(id));

	return {
		effectiveSelectedIds,
		effectiveSelectedIdSet,
		selectedFileEntries,
		selectedCount,
		selectedEntriesCanDelete,
		selectedEntriesCanMove,
		selectedEntriesCanCompress,
		allSelected,
		someSelected: selectedCount > 0 && !allSelected,
		selectableFileIds,
	};
}
