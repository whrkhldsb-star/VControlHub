import { Readable } from "node:stream";

/**
 * Convert a Node.js Readable stream to a Web ReadableStream.
 * Falls back to a direct cast for test mocks that aren't true Node Readable streams.
 */
export function nodeStreamToWeb(nodeStream: NodeJS.ReadableStream): ReadableStream {
	if (!(nodeStream instanceof Readable)) {
		return nodeStream as unknown as ReadableStream;
	}

	let closed = false;
	return new ReadableStream<Uint8Array>({
		start(controller) {
			const cleanup = () => {
				nodeStream.off("data", onData);
				nodeStream.off("end", onEnd);
				nodeStream.off("error", onError);
				nodeStream.off("close", onClose);
			};
			const onData = (chunk: Buffer | string) => {
				if (closed) return;
				controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
				if ((controller.desiredSize ?? 0) <= 0) nodeStream.pause();
			};
			const onEnd = () => {
				if (closed) return;
				closed = true;
				controller.close();
			};
			const onError = (error: Error) => {
				if (!closed) {
					closed = true;
					controller.error(error);
				}
			};
			const onClose = () => { onEnd(); cleanup(); };
			nodeStream.on("data", onData);
			nodeStream.once("end", onEnd);
			nodeStream.once("error", onError);
			nodeStream.once("close", onClose);
		},
		pull() {
			if (!closed) nodeStream.resume();
		},
		cancel() {
			// Late SSH/file events can arrive before destroy emits close. Guard
			// them immediately, retaining listeners until teardown completes.
			closed = true;
			nodeStream.destroy();
		},
	}, {
		highWaterMark: 64 * 1024,
		size: (chunk) => chunk.byteLength,
	});
}
