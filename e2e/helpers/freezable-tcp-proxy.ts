import { createServer, connect, type Socket } from "node:net";

/**
 * A TCP relay in front of the app that can make its WebSocket connections go
 * silent without closing them — what a CDN edge, a NAT that forgot the flow
 * or a lossy intercontinental link does to a long-lived socket. Neither end
 * sees a FIN or RST: bytes simply stop arriving. HTTP connections are left
 * alone so the page can still fetch a new handshake token and reconnect.
 */
export async function startFreezableTcpProxy(options: { listenPort: number; targetPort: number; host?: string }) {
	const host = options.host ?? "127.0.0.1";
	type Pair = { client: Socket; upstream: Socket; websocket: boolean; frozen: boolean };
	const pairs = new Set<Pair>();
	const server = createServer((client) => {
		const upstream = connect(options.targetPort, host);
		const pair: Pair = { client, upstream, websocket: false, frozen: false };
		pairs.add(pair);
		let sniffed = false;
		client.on("data", (chunk: Buffer) => {
			if (!sniffed) {
				sniffed = true;
				pair.websocket = /^GET \/ssh[/?]/.test(chunk.subarray(0, 16).toString("latin1"));
			}
			if (!pair.frozen) upstream.write(chunk);
		});
		upstream.on("data", (chunk: Buffer) => { if (!pair.frozen) client.write(chunk); });
		const close = () => { pairs.delete(pair); client.destroy(); upstream.destroy(); };
		client.on("close", close);
		upstream.on("close", close);
		client.on("error", close);
		upstream.on("error", close);
	});
	await new Promise<void>((resolve) => server.listen(options.listenPort, host, resolve));
	return {
		/**
		 * Silence every open terminal WebSocket; new connections pass. `drop`:
		 * bytes are accepted and lost (the sender never notices); `stall`: the
		 * relay stops reading, so the senders' buffers fill up (backpressure).
		 * Returns how many sockets went silent.
		 */
		freezeWebSockets(mode: "drop" | "stall" = "drop") {
			let count = 0;
			for (const pair of pairs) {
				if (!pair.websocket || pair.frozen) continue;
				pair.frozen = true;
				if (mode === "stall") { pair.client.pause(); pair.upstream.pause(); }
				count += 1;
			}
			return count;
		},
		openWebSockets() {
			return [...pairs].filter((pair) => pair.websocket && !pair.frozen).length;
		},
		close: () => new Promise<void>((resolve) => {
			for (const pair of pairs) { pair.client.destroy(); pair.upstream.destroy(); }
			server.close(() => resolve());
		}),
	};
}
