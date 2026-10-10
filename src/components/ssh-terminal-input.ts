/**
 * Ordered, bounded terminal input. Never replay pending commands after reconnect.
 *
 * Gateways that acknowledge input get a sliding window: keystrokes go out at
 * once while fewer than INPUT_WINDOW_CHUNKS chunks (INPUT_WINDOW_BYTES) await
 * an input-ack. Acks are cumulative and only meter the flow, so a slow SSH
 * writer cannot make the gateway buffer without limit. The previous
 * stop-and-wait pipe (one chunk per round trip) made every key typed during a
 * round trip wait for the previous ack — on a high-latency or lossy link
 * (CDN-proxied WebSocket, mobile) typing felt sticky.
 */
export const INPUT_WINDOW_CHUNKS = 16;
export const INPUT_WINDOW_BYTES = 64 * 1024;

export function createSshTerminalInputSender(
	socket: Pick<WebSocket, "readyState" | "bufferedAmount" | "send">,
	onOverflow: () => void,
) {
	const maxPendingBytes = 4 * 1024 * 1024;
	const queue: Uint8Array[] = [];
	let offset = 0;
	let pendingBytes = 0;
	let connected = false;
	let disposed = false;
	let supportsAck = false;
	let sequence = 0;
	const inFlight: Array<{ id: number; bytes: number }> = [];
	let inFlightBytes = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const schedule = () => {
		if (!timer && !disposed) timer = setTimeout(() => { timer = undefined; flush(); }, 125);
	};
	// Acks that stop arriving (proxy hiccup, mobile network switch) must not
	// wedge the window: after the deadline without progress the in-flight
	// accounting is released and queued keys go out. Nothing is re-sent — a
	// lost ack is far more common than lost input on a TCP transport.
	const ACK_TIMEOUT_MS = 5_000;
	let ackTimer: ReturnType<typeof setTimeout> | undefined;
	const clearAckTimer = () => {
		if (ackTimer) { clearTimeout(ackTimer); ackTimer = undefined; }
	};
	const armAckTimer = () => {
		clearAckTimer();
		if (!inFlight.length) return;
		ackTimer = setTimeout(() => {
			ackTimer = undefined;
			inFlight.length = 0;
			inFlightBytes = 0;
			flush();
		}, ACK_TIMEOUT_MS);
		ackTimer.unref?.();
	};
	/** Take up to `limit` bytes from the queue, coalescing small keystrokes. */
	const takeChunk = (limit: number): Uint8Array => {
		const parts: Uint8Array[] = [];
		let size = 0;
		while (queue.length && size < limit) {
			const head = queue[0]!;
			const part = head.subarray(offset, offset + (limit - size));
			parts.push(part);
			size += part.length;
			offset += part.length;
			if (offset === head.length) { queue.shift(); offset = 0; }
		}
		if (parts.length === 1) return parts[0]!;
		const chunk = new Uint8Array(size);
		let position = 0;
		for (const part of parts) { chunk.set(part, position); position += part.length; }
		return chunk;
	};
	const send = (chunk: Uint8Array, id?: number): boolean => {
		const data = btoa(String.fromCharCode(...chunk));
		try { socket.send(JSON.stringify({ type: "input", data, ...(id === undefined ? {} : { id }) })); }
		catch { dispose(); return false; }
		pendingBytes -= chunk.length;
		return true;
	};
	const flush = () => {
		if (disposed || !connected || socket.readyState !== 1 || !queue.length) return;
		if (!supportsAck) {
			// Legacy gateways have no ACK: 3 KiB / 125 ms also stays below their
			// pending-input budget during the five-second authorization deadline.
			if (timer) return;
			if (socket.bufferedAmount > 64 * 1024) { schedule(); return; }
			if (!send(takeChunk(3 * 1024))) return;
			if (queue.length) schedule();
			return;
		}
		while (queue.length && inFlight.length < INPUT_WINDOW_CHUNKS && inFlightBytes < INPUT_WINDOW_BYTES) {
			if (socket.bufferedAmount > 64 * 1024) { schedule(); return; }
			const chunk = takeChunk(Math.min(12 * 1024, INPUT_WINDOW_BYTES - inFlightBytes));
			const id = ++sequence;
			if (!send(chunk, id)) return;
			inFlight.push({ id, bytes: chunk.length });
			inFlightBytes += chunk.length;
			if (inFlight.length === 1) armAckTimer();
		}
	};
	const dispose = () => {
		disposed = true;
		clearTimeout(timer);
		clearAckTimer();
		queue.length = 0;
		pendingBytes = 0;
		inFlight.length = 0;
		inFlightBytes = 0;
	};
	return {
		enqueue(text: string): boolean {
			if (disposed || !text) return false;
			// Check before allocating/queuing the entire paste, and reject an
			// oversized event in full rather than executing a truncated command.
			if (text.length > maxPendingBytes) { onOverflow(); return false; }
			const bytes = new TextEncoder().encode(text);
			if (pendingBytes + bytes.length > maxPendingBytes) { onOverflow(); return false; }
			queue.push(bytes);
			pendingBytes += bytes.length;
			flush();
			return true;
		},
		connected(ackSupported: boolean) { connected = true; supportsAck = ackSupported; flush(); },
		/** Cumulative: an ack releases every in-flight chunk up to and including `id`. */
		acknowledge(id: unknown) {
			if (typeof id !== "number" || !inFlight.length || id < inFlight[0]!.id) return;
			while (inFlight.length && inFlight[0]!.id <= id) inFlightBytes -= inFlight.shift()!.bytes;
			armAckTimer();
			flush();
		},
		dispose,
	};
}
