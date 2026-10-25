import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FileTypeIcon, getFileExtension, getFileKind } from "../file-entry-icons";
import { validateEntryName } from "../file-actions";

describe("getFileKind", () => {
	it("reads the MIME type first", () => {
		expect(getFileKind({ entryType: "DIRECTORY" })).toBe("folder");
		expect(getFileKind({ mimeType: "inode/directory" })).toBe("folder");
		expect(getFileKind({ mimeType: "image/png", name: "a.txt" })).toBe("image");
		expect(getFileKind({ mimeType: "video/mp4" })).toBe("video");
		expect(getFileKind({ mimeType: "audio/mpeg" })).toBe("audio");
		expect(getFileKind({ mimeType: "application/pdf" })).toBe("pdf");
		expect(getFileKind({ mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe("doc");
		expect(getFileKind({ mimeType: "application/vnd.ms-excel" })).toBe("sheet");
		expect(getFileKind({ mimeType: "text/csv" })).toBe("sheet");
		expect(getFileKind({ mimeType: "application/vnd.ms-powerpoint" })).toBe("slides");
	});

	it("falls back to the extension for generic or missing types (SFTP, WebDAV)", () => {
		expect(getFileKind({ mimeType: "application/octet-stream", name: "backup.tar.gz" })).toBe("archive");
		expect(getFileKind({ mimeType: null, name: "deploy.sh" })).toBe("code");
		expect(getFileKind({ mimeType: "", name: "notes.md" })).toBe("text");
		expect(getFileKind({ mimeType: "application/octet-stream", name: "预算.XLSX" })).toBe("sheet");
		expect(getFileKind({ mimeType: "application/octet-stream", name: "clip.mkv" })).toBe("video");
		expect(getFileKind({ mimeType: "application/octet-stream", name: "无扩展名文件" })).toBe("file");
		expect(getFileKind({ mimeType: "application/x-unknown", name: ".hidden-config" })).toBe("file");
	});

	it("still recognises generic archive and code MIME types without a known extension", () => {
		expect(getFileKind({ mimeType: "application/x-7z-compressed", name: "bundle" })).toBe("archive");
		expect(getFileKind({ mimeType: "application/json", name: "data" })).toBe("code");
		expect(getFileKind({ mimeType: "text/plain", name: "README" })).toBe("text");
	});
});

describe("getFileExtension", () => {
	it("ignores leading dots and directories", () => {
		expect(getFileExtension("dir.v2/report.PDF")).toBe("pdf");
		expect(getFileExtension(".env")).toBe("");
		expect(getFileExtension("archive.tar.gz")).toBe("gz");
		expect(getFileExtension(undefined)).toBe("");
	});
});

describe("FileTypeIcon", () => {
	it("shows the extension badge only where it is legible", () => {
		const large = render(<FileTypeIcon entry={{ entryType: "FILE", mimeType: "application/pdf", name: "x.pdf" }} size={56} />);
		expect(large.container.querySelector("text")?.textContent).toBe("PDF");
		const small = render(<FileTypeIcon entry={{ entryType: "FILE", mimeType: "application/pdf", name: "x.pdf" }} size={24} />);
		expect(small.container.querySelector("text")).toBeNull();
		expect(small.container.querySelector("svg")?.getAttribute("data-file-kind")).toBe("pdf");
	});

	it("shortens long extensions and draws folders without a badge", () => {
		const sheet = render(<FileTypeIcon entry={{ entryType: "FILE", mimeType: null, name: "budget.numbers" }} size={48} />);
		expect(sheet.container.querySelector("text")?.textContent).toBe("NUMB");
		const folder = render(<FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={48} />);
		expect(folder.container.querySelector("svg")?.getAttribute("data-file-kind")).toBe("folder");
		expect(folder.container.querySelector("text")).toBeNull();
	});
});

describe("validateEntryName", () => {
	it("accepts what the server accepts, spaces included", () => {
		expect(validateEntryName("屏幕截图 2026-10-01 14.31.png")).toBeNull();
		expect(validateEntryName("  New Folder  ")).toBeNull();
		expect(validateEntryName("🎉 emoji.txt")).toBeNull();
	});

	it("rejects empty, dot, separator, reserved and over-long names", () => {
		expect(validateEntryName("   ")).toBe("required");
		expect(validateEntryName("..")).toBe("dots");
		expect(validateEntryName("a/b")).toBe("invalidChars");
		expect(validateEntryName("a\\b")).toBe("invalidChars");
		// Ordinary on Linux; a node on Windows refuses them itself.
		expect(validateEntryName("what?")).toBeNull();
		expect(validateEntryName("v2: draft|final")).toBeNull();
		expect(validateEntryName("tab\there")).toBe("invalidChars");
		expect(validateEntryName("x".repeat(256))).toBe("tooLong");
	});
});
