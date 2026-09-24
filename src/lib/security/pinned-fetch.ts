/**
 * DNS-pinned fetch for outbound calls to operator-configured URLs.
 *
 * Several flows (AI providers, billing CSV sources, app-source catalogs, the
 * direct-access gateway health probe) validate that a URL resolves to a public
 * address and then hand the URL to a plain `fetch` — which resolves DNS a
 * second time. An attacker controlling the domain's DNS can answer the
 * pre-check with a public IP and the real fetch with 127.0.0.1 or a cloud
 * metadata address (DNS rebinding TOCTOU).
 *
 * This helper performs the resolve-validate-pin-fetch sequence in one place:
 * the address verified here is the address undici connects to (custom
 * `lookup` in the connect options), while SNI and certificate validation keep
 * using the original hostname. Pattern proven by the WebDAV client transport
 * (`src/lib/storage/webdav-client.ts`) and webhook delivery
 * (`src/lib/security/webhook-url.ts`).
 *
 * Callers keep their own URL *policy* (scheme, host denylists, public-IP
 * assertions) and call this only after validation passed.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

import { isUnsafePublicHttpHost } from "@/lib/storage/direct-access-url";
import { isBlockedIpAddress } from "@/lib/security/ip-blocklist";

export type PinnedFetchOptions = {
	/** Per-stage agent timeouts. Defaults are undici's (300s headers/body);
	 * callers that already bound the whole request with an AbortSignal can
	 * leave these alone. */
	headersTimeoutMs?: number;
	bodyTimeoutMs?: number;
	connectTimeoutMs?: number;
};

/**
 * Resolve `rawUrl` and fetch it over a dispatcher pinned to the verified
 * address. Throws when DNS fails or any resolved address is non-public; the
 * error message is deliberately generic because callers translate failures.
 *
 * The returned Response is detached from the dispatcher lifecycle: its body
 * is a wrapper stream that destroys the dispatcher on end/error/cancel, so
 * streaming responses (AI chat) stay valid as long as the caller reads them.
 */
export async function fetchWithPinnedDns(
	rawUrl: string | URL,
	init: RequestInit,
	options: PinnedFetchOptions = {},
): Promise<Response> {
	const url = new URL(rawUrl);
	const hostname = url.hostname.replace(/^\[|\]$/g, "");

	const addresses = isIP(hostname)
		? [{ address: hostname, family: isIP(hostname) }]
		: await lookup(hostname, { all: true, verbatim: true });
	if (
		addresses.length === 0 ||
		addresses.some(({ address }) => isBlockedIpAddress(address) || isUnsafePublicHttpHost(address))
	) {
		throw new Error("URL resolved to a non-public address");
	}
	const pinned = addresses[0]!;

	const dispatcher = new Agent({
		headersTimeout: options.headersTimeoutMs ?? 300_000,
		bodyTimeout: options.bodyTimeoutMs ?? 300_000,
		connect: {
			timeout: options.connectTimeoutMs ?? 15_000,
			lookup(name, opts, callback) {
				// A redirect (or anything re-resolving a different host) must not
				 // silently bypass the pin — fail the connection instead.
				if (name !== hostname) {
					callback(new Error("Pinned-fetch target host mismatch"), undefined as never, undefined as never);
					return;
				}
				if (typeof opts === "object" && opts?.all) {
					callback(null, [pinned], undefined as never);
					return;
				}
				callback(null, pinned.address, pinned.family);
			},
		},
	});

	const dispose = () => dispatcher.destroy().catch(() => undefined);
	try {
		const upstream = await undiciFetch(url, {
			...init,
			dispatcher,
		} as unknown as Parameters<typeof undiciFetch>[1]);
		if (!upstream.body) {
			await dispose();
			return new Response(null, {
				status: upstream.status,
				statusText: upstream.statusText,
				headers: Object.fromEntries(upstream.headers as unknown as Iterable<[string, string]>),
			});
		}
		const reader = upstream.body.getReader();
		let stopped = false;
		const finish = async (cancel = false) => {
			if (stopped) return;
			stopped = true;
			try {
				if (cancel) await reader.cancel().catch(() => undefined);
			} finally {
				reader.releaseLock();
				await dispose();
			}
		};
		const body = new ReadableStream<Uint8Array>({
			async pull(controller) {
				if (stopped) return;
				try {
					const next = await reader.read();
					if (stopped) return;
					if (next.done) {
						controller.close();
						await finish();
					} else {
						controller.enqueue(next.value);
					}
				} catch (error) {
					if (!stopped) controller.error(error);
					await finish(true);
				}
			},
			cancel() {
				return finish(true);
			},
		});
		return new Response(body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: Object.fromEntries(upstream.headers as unknown as Iterable<[string, string]>),
		});
	} catch (error) {
		await dispose();
		throw error;
	}
}
