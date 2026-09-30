/** Ordered, bounded terminal input. Never replay pending commands after reconnect. */
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
	let awaiting: number | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const schedule = () => {
		if (!timer && !disposed) timer = setTimeout(() => { timer = undefined; flush(); }, 125);
	};
	const flush = () => {
		if (disposed || !connected || awaiting !== null || socket.readyState !== 1 || !queue.length) return;
		if (!supportsAck && timer) return;
		if (socket.bufferedAmount > 64 * 1024) { schedule(); return; }
		// Legacy gateways have no ACK: 3 KiB / 125 ms also stays below their
		// pending-input budget during the five-second authorization deadline.
		const chunkBytes = supportsAck ? 12 * 1024 : 3 * 1024;
		const head = queue[0]!;
		const chunk = head.subarray(offset, offset + chunkBytes);
		const data = btoa(String.fromCharCode(...chunk));
		const id = ++sequence;
		if (supportsAck) awaiting = id;
		try { socket.send(JSON.stringify({ type: "input", data, ...(supportsAck ? { id } : {}) })); }
		catch { dispose(); return; }
		offset += chunk.length;
		pendingBytes -= chunk.length;
		if (offset === head.length) { queue.shift(); offset = 0; }
		if (!supportsAck && queue.length) schedule();
	};
	const dispose = () => {
		disposed = true;
		clearTimeout(timer);
		queue.length = 0;
		pendingBytes = 0;
		awaiting = null;
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
		acknowledge(id: unknown) {
			if (awaiting === null || id !== awaiting) return;
			awaiting = null;
			flush();
		},
		dispose,
	};
}
