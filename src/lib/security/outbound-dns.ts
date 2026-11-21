import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LookupAddress } from "node:dns";

export function normalizedHostname(hostname: string) {
	return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

// getaddrinfo cannot be cancelled. Keep its slot until the underlying call
// settles, even when its caller has already timed out.
const MAX_PENDING_LOOKUPS = 64;
let pending = 0;

export async function resolveOutboundAddresses(hostname: string, signal: AbortSignal): Promise<LookupAddress[]> {
	signal.throwIfAborted();
	const host = normalizedHostname(hostname);
	const family = isIP(host);
	if (family) return [{ address: host, family }];
	if (pending >= MAX_PENDING_LOOKUPS) throw new Error("Too many pending DNS lookups");

	const resolution = lookup(host, { all: true, verbatim: true });
	pending++;
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		resolution.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", onAbort);
			pending--;
		});
	});
}
