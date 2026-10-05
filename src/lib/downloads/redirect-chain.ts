/**
 * Redirect resolution for relay (aria2) downloads, which run on the control
 * plane itself.
 *
 * aria2 used to follow up to three redirects with no check on where they
 * pointed, and it resolves DNS on its own — so a public URL that answered
 * `302 Location: http://169.254.169.254/...` (cloud metadata) or a loopback
 * service had the control plane download it and publish it into storage the
 * requester can read. aria2 now gets `max-redirect=0`; this module follows
 * the chain itself, one hop at a time, validating every hop with the same
 * public-address rules as the original URL and connecting only to the address
 * that was validated.
 */
import { Agent, request } from "undici";

import { assertDownloadSourceUrlSafe, type DownloadSourceResolution } from "./source-url";

export const MAX_DOWNLOAD_REDIRECTS = 5;
const PROBE_TIMEOUT_MS = 15_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Asks one validated, pinned hop for its redirect target (null = not a redirect). */
export type RedirectProbe = (url: string, resolution: DownloadSourceResolution) => Promise<string | null>;

export async function resolveDownloadRedirects(
	rawUrl: string,
	options: { probe?: RedirectProbe; maxRedirects?: number } = {},
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
	const probe = options.probe ?? probeRedirect;
	const maxRedirects = options.maxRedirects ?? MAX_DOWNLOAD_REDIRECTS;
	let current = rawUrl;
	for (let hop = 0; ; hop++) {
		const safe = await assertDownloadSourceUrlSafe(current);
		if (!safe.ok) return { ok: false, reason: hop === 0 ? safe.reason : `Redirect target rejected: ${safe.reason}` };
		// Magnet links have no HTTP redirect chain.
		if (!safe.resolution) return { ok: true, url: current };
		let location: string | null;
		try {
			location = await probe(current, safe.resolution);
		} catch {
			// The probe is only a convenience: aria2 runs with max-redirect=0, so an
			// unprobed redirect fails the download instead of being followed.
			return { ok: true, url: current };
		}
		if (!location) return { ok: true, url: current };
		if (hop >= maxRedirects) return { ok: false, reason: "Download URL redirects too many times" };
		try {
			current = new URL(location, current).toString();
		} catch {
			return { ok: false, reason: "Download URL redirects to an invalid location" };
		}
	}
}

async function probeRedirect(url: string, resolution: DownloadSourceResolution): Promise<string | null> {
	const dispatcher = new Agent({
		headersTimeout: PROBE_TIMEOUT_MS,
		bodyTimeout: PROBE_TIMEOUT_MS,
		connect: {
			timeout: PROBE_TIMEOUT_MS,
			lookup(hostname, options, callback) {
				if (hostname !== resolution.hostname) {
					callback(new Error("Unverified host"), undefined as never, undefined as never);
					return;
				}
				const family = resolution.address.includes(":") ? 6 : 4;
				if (typeof options === "object" && options?.all) {
					callback(null, [{ address: resolution.address, family }], undefined as never);
					return;
				}
				callback(null, resolution.address, family);
			},
		},
	});
	try {
		for (const method of ["HEAD", "GET"] as const) {
			const response = await request(url, {
				method,
				dispatcher,
				headers: method === "GET" ? { range: "bytes=0-0" } : undefined,
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
			});
			response.body.destroy();
			// Some servers refuse HEAD; ask again with a one-byte GET.
			if (method === "HEAD" && (response.statusCode === 405 || response.statusCode === 501)) continue;
			if (!REDIRECT_STATUSES.has(response.statusCode)) return null;
			const location = response.headers.location;
			return Array.isArray(location) ? location[0] ?? null : location ?? null;
		}
		return null;
	} finally {
		await dispatcher.close().catch(() => undefined);
	}
}
