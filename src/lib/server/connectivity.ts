import net from "node:net";

/**
 * Result of a single TCP-level reachability probe.
 *
 * - `ok: true`   — TCP handshake completed within the deadline; `latencyMs` is
 *                  the time from connect() to the socket's `connect` event.
 * - `ok: false`  — either the socket errored (refused / unreachable / DNS), or
 *                  the connect attempt exceeded `timeoutMs`. `error` is a short,
 *                  user-facing string suitable for status messages.
 */
export type TcpProbeResult = {
	ok: boolean;
	latencyMs?: number;
	error?: string;
};

/**
 * Open a TCP socket to `host:port` and report whether the kernel managed to
 * complete the 3-way handshake. This is intentionally NOT a health check on
 * the SSH daemon itself: a successful probe just means "the host is up and
 * accepting connections on this port", which is enough to disambiguate
 * "network unreachable" (probe fails) from "SSH misconfigured / hung" (probe
 * ok, downstream SSH fails) in the health rollup.
 *
 * The probe is single-shot, has no side effects, and always resolves — it
 * never throws. Callers can fire many in parallel without backpressure.
 */
export function tcpProbe(
	host: string,
	port: number,
	timeoutMs = 2_000,
): Promise<TcpProbeResult> {
	return new Promise<TcpProbeResult>((resolve) => {
		const start = Date.now();
		const socket = new net.Socket();
		let settled = false;

		const finish = (result: TcpProbeResult) => {
			if (settled) return;
			settled = true;
			socket.removeAllListeners();
			socket.destroy();
			resolve(result);
		};

		socket.setTimeout(timeoutMs);
		socket.once("connect", () =>
			finish({ ok: true, latencyMs: Date.now() - start }),
		);
		socket.once("timeout", () =>
			finish({ ok: false, error: `连接超时 (${timeoutMs}ms)` }),
		);
		socket.once("error", (err: NodeJS.ErrnoException) => {
			// err.code is the kernel errno / DNS code; that's what we want
			// surface (ECONNREFUSED, EHOSTUNREACH, ENOTFOUND, ...). Fall back
			// to err.message for unknown / non-Node exceptions.
			finish({ ok: false, error: err.code ?? err.message });
		});

		try {
			socket.connect(port, host);
		} catch (err) {
			// Synchronous connect() errors are rare (mostly bad arguments);
			// we still want to settle the promise rather than crash callers.
			finish({
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	});
}
