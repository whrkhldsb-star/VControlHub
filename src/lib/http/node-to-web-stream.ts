import { Readable } from "node:stream";

/**
 * Convert a Node.js Readable stream to a Web ReadableStream.
 * Falls back to a direct cast for test mocks that aren't true Node Readable streams.
 */
export function nodeStreamToWeb(nodeStream: NodeJS.ReadableStream): ReadableStream {
	if (!(nodeStream instanceof Readable)) {
		return nodeStream as unknown as ReadableStream;
	}

	return new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const cleanup = () => {
				nodeStream.off("data", onData);
				nodeStream.off("end", onEnd);
				nodeStream.off("error", onError);
				nodeStream.off("close", onClose);
			};
			const closeController = () => {
				if (closed) return;
				closed = true;
				cleanup();
				try {
					controller.close();
				} catch {
				}
			};
			const onData = (chunk: Buffer | string) => {
				if (closed) return;
				try {
					controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
				} catch {
					closed = true;
					cleanup();
					nodeStream.destroy();
				}
			};
			const onEnd = () => closeController();
			const onClose = () => closeController();
			const onError = (error: Error) => {
				if (closed) return;
				closed = true;
				cleanup();
				try {
					controller.error(error);
				} catch {
				}
			};

			nodeStream.on("data", onData);
			nodeStream.once("end", onEnd);
			nodeStream.once("error", onError);
			nodeStream.once("close", onClose);
		},
		cancel() {
			nodeStream.destroy();
		},
	});
}
