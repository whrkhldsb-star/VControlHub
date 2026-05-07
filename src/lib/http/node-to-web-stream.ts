import { Readable } from "node:stream";

/**
 * Convert a Node.js Readable stream to a Web ReadableStream.
 * Falls back to a direct cast for test mocks that aren't true Node Readable streams.
 */
export function nodeStreamToWeb(nodeStream: NodeJS.ReadableStream): ReadableStream {
	if (typeof Readable.toWeb === "function" && nodeStream instanceof Readable) {
		return Readable.toWeb(nodeStream as import("node:stream").Readable) as ReadableStream;
	}
	return nodeStream as unknown as ReadableStream;
}
