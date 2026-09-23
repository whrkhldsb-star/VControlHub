import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * POST /api/itsm/inbound/[connectionId]
 *
 * Public inbound webhook (signature-verified). No session cookie required.
 * Auth is HMAC via X-VControlHub-Signature / X-Hub-Signature-256 / X-Signature.
 */
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { handleInboundWebhook } from "@/lib/itsm/service";
import { apiCatch } from "@/lib/http/api-error";
import { createLogger } from "@/lib/logging";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";
import { getErrorMessage } from "@/lib/http/error-message";
import { readRequestBodyBuffer, RequestBodyTooLargeError } from "@/lib/http/request-body";

export const dynamic = "force-dynamic";

const logger = createLogger("itsm-inbound");

/** Cap public webhook body size before JSON parse / HMAC (DoS guard). */
const MAX_INBOUND_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

type RouteContext = { params: Promise<{ connectionId: string }> };

function pickSignature(headers: Headers): string | null {
	return (
		headers.get("x-vcontrolhub-signature") ||
		headers.get("x-hub-signature-256") ||
		headers.get("x-signature") ||
		headers.get("x-slack-signature") ||
		null
	);
}

export async function POST(request: Request, context: RouteContext) {
	const { connectionId } = await context.params;

	// Async (shared-store) limiter, not the legacy in-memory one. This was the last
	// caller of `checkRateLimit`, and the only unauthenticated endpoint in the app:
	// with REDIS_URL configured every other route limits across instances while this
	// one silently counted per process, so N instances meant N× the intended budget
	// on the one surface an anonymous caller can reach.
	//
	// Limit per connection AND per source IP: keyed on connectionId alone, anyone who
	// learns one id can exhaust that connection's budget and lock out its real sender.
	const clientIp = getClientIp(request);
	const [connectionLimit, ipLimit] = await Promise.all([
		checkRateLimitAsync(`itsm-inbound:conn:${connectionId}`, GENERAL_WRITE_LIMIT),
		checkRateLimitAsync(`itsm-inbound:ip:${clientIp}`, GENERAL_WRITE_LIMIT),
	]);
	if (!connectionLimit.allowed || !ipLimit.allowed) {
		const retryAfterMs = Math.max(connectionLimit.retryAfterMs, ipLimit.retryAfterMs);
		return NextResponse.json(
			{ error: apiCopy("apiCopy.rate.limit.exceeded.95a111e3") },
			{
				status: 429,
				headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
			},
		);
	}

	// Stream-read with a hard in-memory cap: `request.text()` buffers the whole
	// body first, so a chunked request without Content-Length would bypass the
	// declared-length check above and allocate unbounded memory.
	let rawBody: Buffer;
	try {
		rawBody = await readRequestBodyBuffer(request, MAX_INBOUND_BODY_BYTES);
	} catch (error) {
		if (error instanceof RequestBodyTooLargeError) {
			return NextResponse.json({ error: apiCopy("apiCopy.request.body.too.large.c49c1143") }, { status: 413 });
		}
		throw error;
	}

	let json: Record<string, unknown> = {};
	try {
		json = rawBody.length > 0 ? (JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>) : {};
	} catch {
		return NextResponse.json({ error: apiCopy("apiCopy.invalid.json.body.7ea5df57") }, { status: 400 });
	}

	// Prefer earliest admin-linked user, else first user for system-authored inbound tickets
	const adminRole = await prisma.role.findFirst({
		where: { key: "admin" },
		select: { id: true },
	});
	const systemUser =
		(adminRole
			? await prisma.user.findFirst({
					where: { roles: { some: { roleId: adminRole.id } } },
					select: { id: true },
					orderBy: { createdAt: "asc" },
				})
			: null) ??
		(await prisma.user.findFirst({
			select: { id: true },
			orderBy: { createdAt: "asc" },
		}));

	if (!systemUser) {
		return NextResponse.json(
			{ error: apiCopy("apiCopy.no.system.user.available.for.inbound.tickets.42bc58a7") },
			{ status: 503 },
		);
	}

	try {
		const result = await handleInboundWebhook({
			connectionId,
			rawBody: rawBody.toString("utf8"),
			signatureHeader: pickSignature(request.headers),
			json,
			systemUserId: systemUser.id,
		});
		return NextResponse.json({
			ok: result.event.status === "ok" || result.event.status === "ignored",
			action: result.action,
			ticketId: result.ticketId,
			eventId: result.event.id,
			status: result.event.status,
		});
	} catch (err) {
		const message = getErrorMessage(err, "Inbound webhook failed");
		logger.warn("inbound rejected", { connectionId, message });
		// Typed AppError (NotFound/Forbidden/Validation) maps status correctly.
		return apiCatch(err);
	}
}
// guardMode: public (signature-verified inbound webhook; no session)
