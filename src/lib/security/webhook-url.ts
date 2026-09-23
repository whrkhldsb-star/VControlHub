import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { recordDelivery } from "@/lib/monitoring/runtime-metrics";
import { isBlockedIpAddress } from "@/lib/security/ip-blocklist";

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);

export function validateWebhookUrlSyntax(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { ok: false as const, error: "Webhook URL format is invalid" };
	}
	if (url.protocol !== "https:") return { ok: false as const, error: "Webhook URL must use https://" };
	if (url.username || url.password) return { ok: false as const, error: "Webhook URL must not contain username or password" };
	const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
	if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost")) {
		return { ok: false as const, error: "Webhook URL must not point to local or intranet addresses" };
	}
	if (isIP(hostname) && isBlockedIpAddress(hostname)) {
		return { ok: false as const, error: "Webhook URL must not point to local or intranet addresses" };
	}
	if (hostname.endsWith(".internal") || hostname.endsWith(".local") || hostname.endsWith(".lan")) {
		return { ok: false as const, error: "Webhook URL must not point to internal domains" };
	}
	return { ok: true as const, url: url.toString() };
}

export async function assertWebhookUrlSafeForServerFetch(value: string) {
	const syntax = validateWebhookUrlSyntax(value);
	if (!syntax.ok) return syntax;
	const hostname = new URL(syntax.url).hostname;
	try {
		const addresses = await lookup(hostname, { all: true, verbatim: true });
		if (addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
			return { ok: false as const, error: "Webhook URL DNS resolved to a local or intranet address" };
		}
	} catch {
		return { ok: false as const, error: "Webhook URL DNS resolution failed" };
	}
	return syntax;
}

/**
 * Webhook responses are only inspected for status plus a short body excerpt.
 * Buffer at most this much so a hostile endpoint cannot exhaust memory, and so
 * the per-request dispatcher can be torn down without waiting on an unread body.
 */
const WEBHOOK_RESPONSE_MAX_BYTES = 256 * 1024;

/**
 * Per-stage timeouts for alert/ITSM webhook delivery. Without these the custom
 * Agent only had undici's generous defaults (headers 300s / body 300s), so a
 * black-holed endpoint could pin the alert worker for minutes per delivery —
 * telegram already caps at 15s and SMTP at 10/30s. The overall fetch signal is
 * slightly above the sum of the agent stages so the agent's own error surfaces
 * first (a TimeoutError from the agent reads the same as any other failure).
 */
const WEBHOOK_CONNECT_TIMEOUT_MS = 10_000;
const WEBHOOK_HEADERS_TIMEOUT_MS = 10_000;
const WEBHOOK_BODY_TIMEOUT_MS = 10_000;
const WEBHOOK_FETCH_TIMEOUT_MS = 15_000;

/**
 * Drain a webhook response into a detached Response.
 *
 * `Agent.close()` waits for in-flight bodies to finish; when a caller only
 * checks `response.ok` the socket still holds unread bytes and the close never
 * settles (verified: bodies >64 KiB hang indefinitely). Buffering here keeps the
 * caller-visible API intact while letting us `destroy()` the dispatcher.
 */
export async function detachWebhookResponse(response: Response): Promise<Response> {
	if (!response.body) {
		return new Response(null, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (total < WEBHOOK_RESPONSE_MAX_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			// A single chunk can exceed the budget on its own, so clamp it.
			const remaining = WEBHOOK_RESPONSE_MAX_BYTES - total;
			const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
			total += slice.byteLength;
			chunks.push(slice);
		}
	} catch {
		// A truncated body must not mask the HTTP status the caller needs.
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
	return new Response(Buffer.concat(chunks, total), {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

export async function fetchWebhookSafely(url: string, init: Omit<Dispatcher.RequestOptions, "origin" | "path">) {
	const started = performance.now();
	const finish = (ok: boolean) => {
		recordDelivery("webhook", { ok, durationMs: performance.now() - started });
	};

	const safe = await assertWebhookUrlSafeForServerFetch(url);
	if (!safe.ok) {
		finish(false);
		return safe;
	}
	const parsed = new URL(safe.url);
	const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
	if (addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
		finish(false);
		return { ok: false as const, error: "Webhook URL DNS resolved to a local or intranet address" };
	}
	const pinned = addresses[0]!;
	const dispatcher = new Agent({
		headersTimeout: WEBHOOK_HEADERS_TIMEOUT_MS,
		bodyTimeout: WEBHOOK_BODY_TIMEOUT_MS,
		connect: {
			timeout: WEBHOOK_CONNECT_TIMEOUT_MS,
			lookup(hostname, options, callback) {
				if (hostname !== parsed.hostname) {
					callback(new Error("Webhook URL redirect target is not verified"), undefined as never, undefined as never);
					return;
				}
				if (typeof options === "object" && options?.all) {
					callback(null, [{ address: pinned.address, family: pinned.family }], undefined as never);
					return;
				}
				callback(null, pinned.address, pinned.family);
			},
		},
	});
	try {
		const callerSignal = "signal" in init && init.signal instanceof AbortSignal ? init.signal : undefined;
		const requestInit = {
			...init,
			dispatcher,
			redirect: "error",
			// Belt-and-braces overall cap: the agent stages already bound connect /
			// headers / body, but a slow-drip body would otherwise only be cut by
			// bodyTimeout — this guarantees the whole delivery settles. Callers that
			// pass their own signal (playbook steps, ITSM adapters) keep their
			// cancellation path via AbortSignal.any.
			signal: callerSignal
				? AbortSignal.any([callerSignal, AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS)])
				: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
		} as unknown as Parameters<typeof undiciFetch>[1];
		const response = await undiciFetch(safe.url, requestInit);
		// Detach before the dispatcher goes away: an unread body makes
		// Agent.close() hang forever and Agent.destroy() would abort the read.
		const detached = await detachWebhookResponse(response as unknown as Response);
		finish(detached.ok);
		return { ok: true as const, response: detached };
	} catch {
		finish(false);
		return { ok: false as const, error: "Webhook request failed" };
	} finally {
		await dispatcher.destroy().catch(() => undefined);
	}
}
