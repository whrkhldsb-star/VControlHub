import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { buildStorageStreamHeaders, parseStorageRange, storageStreamResponse } from "../streaming";

describe("storage streaming helpers", () => {
	it("keeps full downloads as 200 responses with byte support headers", () => {
		const range = parseStorageRange(null, 1024);
		expect(range).toEqual({ start: 0, end: 1023, status: 200 });
		if (range instanceof Response) throw new Error("expected range spec");

		const headers = buildStorageStreamHeaders({
			fileName: "demo.txt",
			fileSize: 1024,
			contentType: "text/plain; charset=utf-8",
			download: false,
			range,
		});

		expect(headers.get("accept-ranges")).toBe("bytes");
		expect(headers.get("content-length")).toBe("1024");
		expect(headers.get("content-range")).toBeNull();
		expect(headers.get("content-disposition")).toContain("inline");
	});

	it("parses explicit and suffix byte ranges", () => {
		expect(parseStorageRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19, status: 206 });
		expect(parseStorageRange("bytes=95-", 100)).toEqual({ start: 95, end: 99, status: 206 });
		expect(parseStorageRange("bytes=-5", 100)).toEqual({ start: 95, end: 99, status: 206 });
	});

	it("returns 416 for invalid or zero-byte range requests", () => {
		const invalid = parseStorageRange("bytes=100-200", 100);
		expect(invalid).toBeInstanceOf(Response);
		expect((invalid as Response).status).toBe(416);
		expect((invalid as Response).headers.get("content-range")).toBe("bytes */100");

		const empty = parseStorageRange("bytes=0-1", 0);
		expect(empty).toBeInstanceOf(Response);
		expect((empty as Response).headers.get("content-range")).toBe("bytes */0");
	});

	it("builds 206 responses from node streams", () => {
		const response = storageStreamResponse({
			stream: Readable.from([Buffer.from("hello")]),
			fileName: "片段.mp4",
			fileSize: 100,
			contentType: "video/mp4",
			download: true,
			range: { start: 10, end: 14, status: 206 },
		});

		expect(response.status).toBe(206);
		expect(response.headers.get("content-range")).toBe("bytes 10-14/100");
		expect(response.headers.get("content-length")).toBe("5");
		expect(response.headers.get("content-disposition")).toContain("attachment");
		expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''");
	});
});
