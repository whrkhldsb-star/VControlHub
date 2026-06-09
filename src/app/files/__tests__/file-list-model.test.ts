import { describe, expect, it } from "vitest";

import {
	getSelectableFiles,
	getSelectionSummary,
	getVisibleFiles,
	sortFiles,
	sortFolders,
} from "../file-list-model";
import type { FolderProp } from "../file-list-model";
import type { FileProp } from "../file-list-client";

const baseFile: FileProp = {
	id: "file-a",
	name: "alpha.txt",
	entryType: "FILE",
	mimeType: "text/plain",
	relativePath: "alpha.txt",
	sizeBytes: 10,
	sizeLabel: "10 B",
	previewable: true,
	directAccessMode: "managed-download",
	directAccessHref: "/api/storage/local?path=alpha.txt",
	directAccessDescription: "受控下载",
	storageNodeId: "node-local",
	storageNodeName: "本机存储",
	storageNodeDriver: "LOCAL",
	updatedAt: "2026-06-01T00:00:00.000Z",
};

const baseFolder: FolderProp = {
	name: "folder-a",
	displayName: "A 文件夹",
	path: "folder-a",
	entryId: "folder-a",
	storageNodeId: "node-local",
	relativePath: "folder-a",
	fileCount: 0,
	folderCount: 0,
	sourceKeys: ["node-local"],
	sourceValues: ["本机存储"],
};

describe("file-list-model", () => {
	it("filters directory entries out of the visible file list", () => {
		const directoryEntry: FileProp = {
			...baseFile,
			id: "dir-duplicate",
			name: "folder-a",
			entryType: "DIRECTORY",
			mimeType: "inode/directory",
		};

		expect(getVisibleFiles([baseFile, directoryEntry])).toEqual([baseFile]);
	});

	it("sorts files by selected column without mutating the input", () => {
		const files: FileProp[] = [
			{ ...baseFile, id: "small", name: "b.txt", sizeBytes: 1 },
			{ ...baseFile, id: "large", name: "a.txt", sizeBytes: 100 },
		];

		expect(sortFiles(files, "name", "asc").map((file) => file.name)).toEqual([
			"a.txt",
			"b.txt",
		]);
		expect(sortFiles(files, "size", "desc").map((file) => file.id)).toEqual([
			"large",
			"small",
		]);
		expect(files.map((file) => file.id)).toEqual(["small", "large"]);
	});

	it("sorts folders by display name and preserves non-name source ordering", () => {
		const folders: FolderProp[] = [
			{ ...baseFolder, name: "z", displayName: "Z 文件夹" },
			{ ...baseFolder, name: "a", displayName: "A 文件夹" },
		];

		expect(sortFolders(folders, "name", "asc").map((folder) => folder.name)).toEqual([
			"a",
			"z",
		]);
		expect(sortFolders(folders, "size", "asc").map((folder) => folder.name)).toEqual([
			"z",
			"a",
		]);
	});

	it("selects only writable or deletable files", () => {
		const readableOnly: FileProp = {
			...baseFile,
			id: "readable-only",
			capabilities: { canRead: true, canWrite: false, canDelete: false },
		};
		const writable: FileProp = {
			...baseFile,
			id: "writable",
			capabilities: { canRead: true, canWrite: true, canDelete: false },
		};

		expect(
			getSelectableFiles([readableOnly, writable], {
				canEditLocalFiles: false,
				canDelete: false,
			}).map((file) => file.id),
		).toEqual(["writable"]);
	});

	it("summarizes selected ids within the active scope and permission boundary", () => {
		const writable: FileProp = {
			...baseFile,
			id: "writable",
			capabilities: { canRead: true, canWrite: true, canDelete: true },
		};
		const deleteOnly: FileProp = {
			...baseFile,
			id: "delete-only",
			capabilities: { canRead: true, canWrite: false, canDelete: true },
		};
		const selectableFiles = getSelectableFiles([writable, deleteOnly], {
			canEditLocalFiles: false,
			canDelete: false,
		});

		const summary = getSelectionSummary({
			visibleFiles: [writable, deleteOnly],
			selectableFiles,
			selectedIds: new Set(["writable", "delete-only", "stale"]),
			selectedScopeMatches: true,
			fallbacks: { canEditLocalFiles: false, canDelete: false },
		});

		expect(summary.effectiveSelectedIds).toEqual(["writable", "delete-only"]);
		expect(summary.selectedCount).toBe(2);
		expect(summary.selectedEntriesCanDelete).toBe(true);
		expect(summary.selectedEntriesCanMove).toBe(false);
		expect(summary.allSelected).toBe(true);
		expect(summary.someSelected).toBe(false);
	});

	it("drops stale selected ids when the selection scope changes", () => {
		const summary = getSelectionSummary({
			visibleFiles: [baseFile],
			selectableFiles: [baseFile],
			selectedIds: new Set([baseFile.id]),
			selectedScopeMatches: false,
			fallbacks: { canEditLocalFiles: true, canDelete: true },
		});

		expect(summary.effectiveSelectedIds).toEqual([]);
		expect(summary.selectedCount).toBe(0);
		expect(summary.allSelected).toBe(false);
	});
});
