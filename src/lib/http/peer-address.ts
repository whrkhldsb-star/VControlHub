/**
 * The connection's own address, for rate-limit buckets when no reverse proxy is trusted (`TRUSTED_PROXY_HOPS=0`,
 * the Compose default where the app is exposed directly).
 *
 * Next's route handlers only see headers, not the socket. The custom server (`src/server.ts`) therefore writes the
 * socket's address into {@link PEER_ADDRESS_HEADER} on every request, after removing any copy the client sent, and
 * marks the process ({@link markPeerAddressStamping}). `getClientIp` reads the header only in a process so marked:
 * under `next dev` or another server nothing stamps it, and a client-supplied value is never trusted.
 */
import type { IncomingMessage } from "node:http";

export const PEER_ADDRESS_HEADER = "x-vch-peer-address";
const STAMPING_MARKER = "VCH_PEER_ADDRESS_STAMPED";

/** Called once by the custom server before it accepts connections. */
export function markPeerAddressStamping(): void {
	process.env[STAMPING_MARKER] = "1";
}

/** Whether this process stamps every request with its connection address. */
export function peerAddressIsStamped(): boolean {
	return process.env[STAMPING_MARKER] === "1";
}

/** Replace whatever the client sent under {@link PEER_ADDRESS_HEADER} with the socket's address. */
export function stampPeerAddress(req: IncomingMessage): void {
	const raw = req.rawHeaders;
	for (let index = raw.length - 2; index >= 0; index -= 2) {
		if (raw[index]!.toLowerCase() === PEER_ADDRESS_HEADER) raw.splice(index, 2);
	}
	const address = req.socket?.remoteAddress;
	if (address) {
		req.headers[PEER_ADDRESS_HEADER] = address;
		raw.push(PEER_ADDRESS_HEADER, address);
	} else {
		delete req.headers[PEER_ADDRESS_HEADER];
	}
}
