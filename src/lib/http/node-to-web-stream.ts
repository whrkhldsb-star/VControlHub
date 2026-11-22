import { Readable } from "node:stream";

/**
 * Convert a Node.js Readable stream to a Web ReadableStream.
 * Falls back to a direct cast for test mocks that aren't true Node Readable streams.
 */
export function nodeStreamToWeb(nodeStream: NodeJS.ReadableStream, idleTimeoutMs?: number): ReadableStream {
	if (!(nodeStream instanceof Readable)) {
		return nodeStream as unknown as ReadableStream;
	}

	let closed = false;
	let timer: NodeJS.Timeout | undefined;
	const resetIdle = () => {
		if (!idleTimeoutMs) return;
		if (timer) timer.refresh();
		else {
			timer = setTimeout(() => nodeStream.destroy(new Error("Download stream stalled")), idleTimeoutMs);
			timer.unref();
		}
	};
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
				if ((controller.desiredSize ?? 0) <= 0) {
					nodeStream.pause();
					clearTimeout(timer);
					timer = undefined;
				} else resetIdle();
			};
			const onEnd = () => {
				if (closed) return;
				clearTimeout(timer);
				closed = true;
				controller.close();
			};
			const onError = (error: Error) => {
				if (!closed) {
					clearTimeout(timer);
					closed = true;
					controller.error(error);
				}
			};
			const onClose = () => {
				if (nodeStream.readableEnded) onEnd();
				else onError(new Error("Download stream closed before end"));
				cleanup();
			};
			resetIdle();
			nodeStream.on("data", onData);
			nodeStream.once("end", onEnd);
			nodeStream.once("error", onError);
			nodeStream.once("close", onClose);
		},
		pull() {
			if (!closed && nodeStream.isPaused()) {
				resetIdle();
				nodeStream.resume();
			}
		},
		cancel() {
			// Late SSH/file events can arrive before destroy emits close. Guard
			// them immediately, retaining listeners until teardown completes.
			clearTimeout(timer);
			closed = true;
			nodeStream.destroy();
		},
	}, {
		highWaterMark: 64 * 1024,
		size: (chunk) => chunk.byteLength,
	});
}
