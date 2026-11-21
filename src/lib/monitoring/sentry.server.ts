import * as Sentry from "@sentry/node";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { config } from "@/lib/config/env";

const absoluteUrlFields = ["url", "http.url", "url.full"];
const pathFields = ["http.target", "http.route", "http.query", "http.fragment", "url.path", "url.query", "url.fragment"];
const httpUrl = /https?:\/\/[^\s<>"']+/gi;

function httpOrigin(value: unknown): string | undefined {
	if (typeof value !== "string") return;
	try {
		const url = new URL(value);
		if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
	} catch { /* A relative path or a malformed URL can still contain a credential. */ }
}

type HttpRecord = { data?: Record<string, unknown>; description?: unknown; status?: string };

function scrubHttpRecord(record: HttpRecord, label?: string): string {
	const data = record.data;
	let origin: string | undefined;
	if (data) {
		for (const key of absoluteUrlFields) {
			if (!(key in data)) continue;
			const safe = httpOrigin(data[key]);
			if (safe) {
				data[key] = safe;
				origin ??= safe;
			} else {
				delete data[key];
			}
		}
		for (const key of pathFields) delete data[key];
		delete data["sentry.status.message"];
		delete data["http.status_text"];
	}
	// Undici can use a transport error quoting the request path as the span status.
	if (record.status && record.status !== "ok") {
		const statusCode = data?.["http.response.status_code"] ?? data?.["http.status_code"];
		record.status = typeof statusCode === "number"
			? Sentry.getSpanStatusFromHttpCode(statusCode).message ?? "ok" : "internal_error";
	}
	const description = typeof record.description === "string" ? record.description : label;
	origin ??= httpOrigin(description?.match(httpUrl)?.[0]);
	const safeName = origin ?? "HTTP request";
	if (record.description !== undefined) record.description = safeName;
	if (data) {
		for (const key of ["description", "sentry.custom_span_name"]) {
			if (key in data) data[key] = safeName;
		}
	}
	return safeName;
}

function scrubBreadcrumb(crumb: Sentry.Breadcrumb) {
	if (crumb.type === "http" || ["fetch", "http", "xhr"].includes(crumb.category ?? "")) {
		const safeName = scrubHttpRecord(crumb, crumb.message);
		if (crumb.message !== undefined) crumb.message = safeName;
	}
	return crumb;
}

function isHttpClient(span: HttpRecord & { op?: string }) {
	if (span.op === "http.server") return false;
	return span.op === "http.client" || span.op === "http" || span.op === "resource.fetch"
		|| [...absoluteUrlFields, ...pathFields].some(key => span.data && key in span.data);
}

function scrubEvent<E extends Sentry.Event>(event: E): E {
	for (const crumb of event.breadcrumbs ?? []) scrubBreadcrumb(crumb);
	for (const span of event.spans ?? []) {
		if (isHttpClient(span)) scrubHttpRecord(span);
	}
	const trace = event.contexts?.trace;
	if (trace && isHttpClient(trace)) {
		const safeName = scrubHttpRecord(trace, event.transaction);
		if (event.transaction !== undefined) event.transaction = safeName;
	}
	// Transport errors can also quote the destination in the error message itself.
	const redactUrl = (url: string) => httpOrigin(url) ?? "[URL]";
	if (event.message) event.message = event.message.replace(httpUrl, redactUrl);
	for (const error of event.exception?.values ?? []) {
		if (error.value) error.value = error.value.replace(httpUrl, redactUrl);
	}
	return event;
}

export function registerServerSentry() {
	if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD || !config.sentry.dsn) return;

	// Next emits the incoming request span. Let Sentry instrument outgoing requests.
	process.env.NEXT_OTEL_FETCH_DISABLED = "1";
	Sentry.init({
		dsn: config.sentry.dsn,
		environment: config.nodeEnv,
		release: config.sentry.release,
		tracesSampleRate: config.sentry.tracesSampleRate,
		integrations: [
			Sentry.httpIntegration({ disableIncomingRequestSpans: true }),
			Sentry.nativeNodeFetchIntegration({
				requestHook(span, request) {
					const origin = httpOrigin(request.origin) ?? "HTTP request";
					span.updateName(origin);
					span.setAttributes({ "url.full": origin, "url.path": "", "url.query": "" });
				},
			}),
		],
		beforeBreadcrumb: scrubBreadcrumb,
		beforeSend: scrubEvent,
		beforeSendTransaction: scrubEvent,
	});
}
