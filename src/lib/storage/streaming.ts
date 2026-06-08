import { buildContentDisposition } from "@/lib/http/content-disposition";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";

export type StorageByteRange = {
	start: number;
	end: number;
	status: 200 | 206;
};

export type StorageStreamHeadersInput = {
	fileName: string;
	fileSize: number;
	contentType: string;
	download: boolean;
	range: StorageByteRange;
};

export function parseStorageRange(rangeHeader: string | null, fileSize: number): StorageByteRange | Response {
	if (!rangeHeader) {
		return { start: 0, end: Math.max(fileSize - 1, 0), status: 200 };
	}

	const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
	if (!match || fileSize <= 0) {
		return new Response(null, { status: 416, headers: { "content-range": `bytes */${fileSize}` } });
	}

	const [, rawStart, rawEnd] = match;
	let start: number;
	let end: number;

	if (!rawStart && rawEnd) {
		const suffixLength = Number(rawEnd);
		if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
			return new Response(null, { status: 416, headers: { "content-range": `bytes */${fileSize}` } });
		}
		start = Math.max(fileSize - suffixLength, 0);
		end = fileSize - 1;
	} else {
		start = Number(rawStart);
		end = rawEnd ? Number(rawEnd) : fileSize - 1;
	}

	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= fileSize) {
		return new Response(null, { status: 416, headers: { "content-range": `bytes */${fileSize}` } });
	}

	return { start, end: Math.min(end, fileSize - 1), status: 206 };
}

export function buildStorageStreamHeaders(input: StorageStreamHeadersInput): Headers {
	const headers = new Headers();
	const contentLength = input.fileSize === 0 ? 0 : input.range.end - input.range.start + 1;
	headers.set("content-type", input.contentType || "application/octet-stream");
	headers.set("accept-ranges", "bytes");
	headers.set("content-length", String(contentLength));
	headers.set("cache-control", "private, no-store");
	headers.set("content-disposition", buildContentDisposition(input.download ? "attachment" : "inline", input.fileName));
	if (input.range.status === 206) {
		headers.set("content-range", `bytes ${input.range.start}-${input.range.end}/${input.fileSize}`);
	}
	return headers;
}

export function storageStreamResponse(input: StorageStreamHeadersInput & { stream: NodeJS.ReadableStream }): Response {
	return new Response(nodeStreamToWeb(input.stream), {
		status: input.range.status,
		headers: buildStorageStreamHeaders(input),
	});
}
