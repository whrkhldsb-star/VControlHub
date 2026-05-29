import { describe, expect, it } from "vitest";

import {
	appendDownloadFlag,
	buildDirectDownloadHref,
	buildProxyDownloadHref,
	buildSearchHref,
	getPreviewHref,
	getThumbnailUrl,
	toStorageEntry,
	type FileProp,
} from "../file-entry-utils";

const baseFile: FileProp = {
	id: "file_1",
	name: "report.pdf",
	entryType: "FILE",
	mimeType: "application/pdf",
	relativePath: "docs/report.pdf",
	sizeLabel: "10 KB",
	previewable: true,
	directAccessMode: "managed-download",
	directAccessHref: "/api/storage/local?path=docs%2Freport.pdf",
	directAccessDescription: "受控下载",
	storageNodeId: "node_local",
	storageNodeName: "本机存储",
	storageNodeDriver: "LOCAL",
	updatedAt: "2026-05-04T00:00:00.000Z",
};

describe("file-entry-utils", () => {
	it("builds file browser search URLs from path and filters", () => {
		expect(buildSearchHref("photos", { nodeId: "node_1", q: "cat" })).toBe("/files?path=photos&nodeId=node_1&q=cat");
		expect(buildSearchHref("", { nodeId: "" })).toBe("/files");
	});

	it("maps serialised file props to storage entries", () => {
		expect(toStorageEntry(baseFile)).toMatchObject({
			id: "file_1",
			directAccess: { mode: "managed-download", href: "/api/storage/local?path=docs%2Freport.pdf" },
			storageNode: { id: "node_local", driver: "LOCAL" },
		});
	});

	it("builds proxy and direct download URLs by storage driver", () => {
		const localEntry = toStorageEntry(baseFile);
		expect(buildProxyDownloadHref(localEntry)).toBe("/api/storage/local?path=docs%2Freport.pdf");
		expect(buildDirectDownloadHref(localEntry)).toBeNull();

		const sftpEntry = toStorageEntry({
			...baseFile,
			storageNodeId: "node_sftp",
			storageNodeDriver: "SFTP",
			directAccessMode: "direct-url",
			directAccessHref: "https://cdn.example.com/report.pdf",
		});
		expect(buildProxyDownloadHref(sftpEntry)).toBe("/api/storage/sftp-download?nodeId=node_sftp&path=docs%2Freport.pdf");
		expect(buildDirectDownloadHref(sftpEntry)).toBe("https://cdn.example.com/report.pdf");
	});

	it("adds download flags without losing existing query strings", () => {
		expect(appendDownloadFlag("/api/storage/local?path=a")).toBe("/api/storage/local?path=a&download=1");
		expect(appendDownloadFlag("/api/storage/local")).toBe("/api/storage/local?download=1");
	});

	it("uses managed download links for previews and thumbnails when available", () => {
		const entry = toStorageEntry(baseFile);
		expect(getPreviewHref(entry)).toContain("/files/preview?");
		expect(getPreviewHref(entry)).toContain("href=%2Fapi%2Fstorage%2Flocal%3Fpath%3Ddocs%252Freport.pdf");

		const imageEntry = toStorageEntry({
			...baseFile,
			name: "photo.jpg",
			mimeType: "image/jpeg",
			directAccessHref: "/api/storage/local?path=photo.jpg",
		});
		expect(getThumbnailUrl(imageEntry)).toBe("/api/storage/local?path=photo.jpg");
	});
});
