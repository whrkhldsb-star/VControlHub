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
import { createLogger } from "@/lib/logging";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const logger = createLogger("itsm-inbound");

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

	const rl = checkRateLimit(`itsm-inbound:${connectionId}`, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) {
		return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
	}

	const rawBody = await request.text();
	let json: Record<string, unknown> = {};
	try {
		json = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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
			{ error: "No system user available for inbound tickets" },
			{ status: 503 },
		);
	}

	try {
		const result = await handleInboundWebhook({
			connectionId,
			rawBody,
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
		const message = err instanceof Error ? err.message : "Inbound webhook failed";
		const status = message.includes("not found")
			? 404
			: message.includes("signature") ||
				  message.includes("Missing signature") ||
				  message.includes("secret") ||
				  message.includes("permission") ||
				  message.toLowerCase().includes("forbidden")
				? 401
				: message.includes("disabled") || message.includes("does not accept")
					? 400
					: 400;
		logger.warn("inbound rejected", { connectionId, message });
		return NextResponse.json({ error: message }, { status });
	}
}
