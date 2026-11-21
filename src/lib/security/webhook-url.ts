import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { normalizedHostname, resolveOutboundAddresses } from "./outbound-dns";
import { isIP } from "node:net";

import { t } from "@/lib/i18n/service-translations";
import { recordDelivery } from "@/lib/monitoring/runtime-metrics";
import { isBlockedIpAddress } from "@/lib/security/ip-blocklist";

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);

/**
 * Why a webhook URL is refused, worded where it is decided: the reason is
 * shown when an alert rule, an ITSM connection, a playbook step or a WebDAV
 * endpoint is saved, and kept as the reason a delivery failed.
 */
export function validateWebhookUrlSyntax(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { ok: false as const, error: t("backend.webhookUrl.invalid") };
	}
	if (url.protocol !== "https:") return { ok: false as const, error: t("backend.webhookUrl.httpsRequired") };
	if (url.username || url.password) return { ok: false as const, error: t("backend.webhookUrl.noCredentials") };
	const hostname = normalizedHostname(url.hostname);
	if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost")) {
		return { ok: false as const, error: t("backend.webhookUrl.localAddress") };
	}
	if (isIP(hostname) && isBlockedIpAddress(hostname)) {
		return { ok: false as const, error: t("backend.webhookUrl.localAddress") };
	}
	if (hostname.endsWith(".internal") || hostname.endsWith(".local") || hostname.endsWith(".lan")) {
		return { ok: false as const, error: t("backend.webhookUrl.internalDomain") };
	}
	return { ok: true as const, url: url.toString() };
}

async function resolveWebhookTarget(value: string, signal: AbortSignal) {
	const syntax = validateWebhookUrlSyntax(value);
	if (!syntax.ok) return syntax;
	const hostname = normalizedHostname(new URL(syntax.url).hostname);
	try {
		const addresses = await resolveOutboundAddresses(hostname, signal);
		if (addresses.length === 0 || addresses.some(({ address }) => !isIP(address) || isBlockedIpAddress(address))) {
			return { ok: false as const, error: t("backend.webhookUrl.dnsLocal") };
		}
		return { ...syntax, hostname, addresses };
	} catch {
		return { ok: false as const, error: t("backend.webhookUrl.dnsFailed") };
	}
}

export async function assertWebhookUrlSafeForServerFetch(value: string) {
	const target = await resolveWebhookTarget(value, AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS));
	return target.ok ? { ok: true as const, url: target.url } : target;
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
export async function detachWebhookResponse(response: Response, failOnBodyReadError = false): Promise<Response> {
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
	} catch (error) {
		// Status-only callers can still use the headers after a broken body.
		if (failOnBodyReadError) throw error;
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

export async function fetchWebhookSafely(
	url: string,
	{ failOnBodyReadError, ...init }: Omit<Dispatcher.RequestOptions, "origin" | "path"> & { failOnBodyReadError?: boolean },
) {
	const started = performance.now();
	const finish = (ok: boolean) => {
		recordDelivery("webhook", { ok, durationMs: performance.now() - started });
	};

	const callerSignal = init.signal instanceof AbortSignal ? init.signal : undefined;
	const deadline = AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS);
	const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
	const safe = await resolveWebhookTarget(url, signal);
	if (signal.aborted) {
		finish(false);
		return { ok: false as const, error: "Webhook request aborted before dispatch", dispatched: false as const };
	}
	if (!safe.ok) {
		finish(false);
		return { ...safe, dispatched: false as const };
	}
	const { addresses } = safe;
	const dispatcher = new Agent({
		headersTimeout: WEBHOOK_HEADERS_TIMEOUT_MS,
		bodyTimeout: WEBHOOK_BODY_TIMEOUT_MS,
		connect: {
			timeout: WEBHOOK_CONNECT_TIMEOUT_MS,
			lookup(hostname, options, callback) {
				if (normalizedHostname(hostname) !== safe.hostname) {
					callback(new Error("Webhook URL redirect target is not verified"), undefined as never, undefined as never);
					return;
				}
				if (typeof options === "object" && options?.all) {
					callback(null, addresses, undefined as never);
					return;
				}
				const first = addresses[0]!;
				callback(null, first.address, first.family);
			},
		},
	});
	try {
		const requestInit = {
			...init,
			dispatcher,
			redirect: "error",
			signal,
		} as unknown as Parameters<typeof undiciFetch>[1];
		const response = await undiciFetch(safe.url, requestInit);
		// Detach before the dispatcher goes away: an unread body makes
		// Agent.close() hang forever and Agent.destroy() would abort the read.
		const detached = await detachWebhookResponse(response as unknown as Response, failOnBodyReadError);
		finish(detached.ok);
		return { ok: true as const, response: detached };
	} catch {
		finish(false);
		return { ok: false as const, error: "Webhook request failed", dispatched: true as const };
	} finally {
		await dispatcher.destroy().catch(() => undefined);
	}
}
