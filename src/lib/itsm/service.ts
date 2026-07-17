/**
 * ITSM/IM connection service (FEAT-ITSM-IM-BIDI).
 *
 * - Credentials encrypted at rest (AES-256-GCM)
 * - Outbound: ticket lifecycle fan-out to enabled connections
 * - Inbound: signed webhook → create/update ticket + event log
 * - No fake success: delivery failures recorded on ItsmEvent + lastError
 */
import { Prisma } from "@prisma/client";

import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/service";
import { prisma } from "@/lib/db";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { teamWhere, teamCreateData } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import { addTicketComment, createTicket, updateTicketStatus } from "@/lib/ticket/service";

import {
	assertOutboundReady,
	deliverOutbound,
	normalizeInboundTicket,
	verifyInboundSignature,
} from "./adapters";
import {
	createItsmConnectionSchema,
	updateItsmConnectionSchema,
} from "./schema";
import type {
	ItsmConnectionConfig,
	ItsmConnectionRecord,
	ItsmCredentials,
	ItsmDirection,
	ItsmEventRecord,
	ItsmEventStatus,
	ItsmProvider,
} from "./types";

const logger = createLogger("itsm");

function iso(d: Date | null | undefined): string | null {
	return d ? d.toISOString() : null;
}

function parseConfig(raw: Prisma.JsonValue | null | undefined): ItsmConnectionConfig {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	return raw as ItsmConnectionConfig;
}

function encryptCredentials(creds: ItsmCredentials): string {
	return encrypt(JSON.stringify(creds ?? {}));
}

function decryptCredentials(enc: string): ItsmCredentials {
	if (!enc) return {};
	const plain = isEncrypted(enc) ? decrypt(enc) : enc;
	try {
		const parsed = JSON.parse(plain) as ItsmCredentials;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		throw new ValidationError("Stored ITSM credentials are corrupt");
	}
}

function toConnectionRecord(row: {
	id: string;
	name: string;
	provider: string;
	direction: string;
	enabled: boolean;
	credentialsEnc: string;
	config: Prisma.JsonValue;
	teamId: string | null;
	lastOutboundAt: Date | null;
	lastInboundAt: Date | null;
	lastError: string | null;
	createdById: string | null;
	createdAt: Date;
	updatedAt: Date;
}): ItsmConnectionRecord {
	return {
		id: row.id,
		name: row.name,
		provider: row.provider as ItsmProvider,
		direction: row.direction as ItsmDirection,
		enabled: row.enabled,
		config: parseConfig(row.config),
		hasCredentials: Boolean(row.credentialsEnc),
		teamId: row.teamId,
		lastOutboundAt: iso(row.lastOutboundAt),
		lastInboundAt: iso(row.lastInboundAt),
		lastError: row.lastError,
		createdById: row.createdById,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function toEventRecord(row: {
	id: string;
	connectionId: string | null;
	direction: string;
	eventType: string;
	ticketId: string | null;
	status: string;
	externalId: string | null;
	payload: Prisma.JsonValue;
	errorMessage: string | null;
	createdAt: Date;
}): ItsmEventRecord {
	const payload =
		row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
			? (row.payload as Record<string, unknown>)
			: {};
	return {
		id: row.id,
		connectionId: row.connectionId,
		direction: row.direction as ItsmEventRecord["direction"],
		eventType: row.eventType,
		ticketId: row.ticketId,
		status: row.status as ItsmEventStatus,
		externalId: row.externalId,
		payload,
		errorMessage: row.errorMessage,
		createdAt: row.createdAt.toISOString(),
	};
}

function supportsOutbound(direction: string): boolean {
	return direction === "outbound" || direction === "bidirectional";
}

function supportsInbound(direction: string): boolean {
	return direction === "inbound" || direction === "bidirectional";
}

/**
 * Resolve the teamId stamped on create/update.
 * Non-admin callers may not set another team's id via body — always use session
 * teamCreateData. Admins may pass body.teamId (including null for shared).
 */
function resolveConnectionTeamId(
	session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> | null | undefined,
	bodyTeamId: string | null | undefined,
): string | null {
	if (session && sessionHasPermission(session, "team:manage") && bodyTeamId !== undefined) {
		return bodyTeamId;
	}
	if (session) {
		const fromSession = teamCreateData(session).teamId;
		return fromSession !== undefined ? fromSession : null;
	}
	// System/unscoped callers: allow explicit body teamId, else null
	return bodyTeamId !== undefined ? bodyTeamId : null;
}

export async function createItsmConnection(
	input: unknown,
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> | null,
): Promise<ItsmConnectionRecord> {
	const parsed = createItsmConnectionSchema.parse(input);
	const direction = parsed.direction ?? "bidirectional";
	const config = (parsed.config ?? {}) as ItsmConnectionConfig;
	const credentials = parsed.credentials ?? {};

	if (supportsOutbound(direction) && parsed.provider !== "telegram") {
		assertOutboundReady(parsed.provider, config, credentials);
	}
	if (parsed.provider === "telegram" && supportsOutbound(direction)) {
		assertOutboundReady(parsed.provider, config, credentials);
	}

	const teamId = resolveConnectionTeamId(session, parsed.teamId);
	const row = await prisma.itsmConnection.create({
		data: {
			name: parsed.name,
			provider: parsed.provider,
			direction,
			enabled: parsed.enabled ?? true,
			credentialsEnc: encryptCredentials(credentials),
			config: config as Prisma.InputJsonValue,
			teamId,
			createdById: session?.userId ?? null,
		},
	});
	return toConnectionRecord(row);
}

export async function listItsmConnections(
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<ItsmConnectionRecord[]> {
	const rows = await prisma.itsmConnection.findMany({
		where: session ? teamWhere(session) : {},
		orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
		take: 200,
	});
	return rows.map(toConnectionRecord);
}

export async function getItsmConnection(
	id: string,
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<ItsmConnectionRecord> {
	const row = await prisma.itsmConnection.findFirst({
		where: { id, ...(session ? teamWhere(session) : {}) },
	});
	if (!row) throw new NotFoundError("ITSM connection not found");
	return toConnectionRecord(row);
}

export async function updateItsmConnection(
	id: string,
	input: unknown,
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<ItsmConnectionRecord> {
	const parsed = updateItsmConnectionSchema.parse(input);
	const existing = await prisma.itsmConnection.findFirst({
		where: { id, ...(session ? teamWhere(session) : {}) },
	});
	if (!existing) throw new NotFoundError("ITSM connection not found");

	const data: Prisma.ItsmConnectionUpdateInput = {};
	if (parsed.name !== undefined) data.name = parsed.name;
	if (parsed.direction !== undefined) data.direction = parsed.direction;
	if (parsed.enabled !== undefined) data.enabled = parsed.enabled;
	// Non-admin cannot reassign connection team via body (team spoof / cross-tenant move).
	if (parsed.teamId !== undefined) {
		if (session && !sessionHasPermission(session, "team:manage")) {
			// Ignore spoofed teamId; keep existing assignment
		} else {
			data.teamId = parsed.teamId;
		}
	}
	if (parsed.config !== undefined) data.config = parsed.config as Prisma.InputJsonValue;
	if (parsed.credentials !== undefined) {
		const prev = decryptCredentials(existing.credentialsEnc);
		data.credentialsEnc = encryptCredentials({
			...prev,
			...parsed.credentials,
		});
	}

	const row = await prisma.itsmConnection.update({ where: { id }, data });
	return toConnectionRecord(row);
}

export async function deleteItsmConnection(
	id: string,
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<void> {
	const deleted = await prisma.itsmConnection.deleteMany({
		where: { id, ...(session ? teamWhere(session) : {}) },
	});
	if (deleted.count === 0) throw new NotFoundError("ITSM connection not found");
}

export async function listItsmEvents(input?: {
	connectionId?: string;
	ticketId?: string;
	limit?: number;
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}): Promise<ItsmEventRecord[]> {
	const teamFilter = input?.session ? teamWhere(input.session) : {};
	const rows = await prisma.itsmEvent.findMany({
		where: {
			...(input?.connectionId ? { connectionId: input.connectionId } : {}),
			...(input?.ticketId ? { ticketId: input.ticketId } : {}),
			// Scope via parent connection team when session present
			...(Object.keys(teamFilter).length > 0
				? { connection: teamFilter }
				: {}),
		},
		orderBy: { createdAt: "desc" },
		take: Math.min(input?.limit ?? 100, 200),
	});
	return rows.map(toEventRecord);
}

async function recordEvent(input: {
	connectionId: string | null;
	direction: "inbound" | "outbound";
	eventType: string;
	ticketId?: string | null;
	status: ItsmEventStatus;
	externalId?: string | null;
	payload?: Record<string, unknown>;
	errorMessage?: string | null;
}): Promise<ItsmEventRecord> {
	try {
		const row = await prisma.itsmEvent.create({
			data: {
				connectionId: input.connectionId,
				direction: input.direction,
				eventType: input.eventType,
				ticketId: input.ticketId ?? null,
				status: input.status,
				externalId: input.externalId ?? null,
				payload: (input.payload ?? {}) as Prisma.InputJsonValue,
				errorMessage: input.errorMessage ?? null,
			},
		});
		return toEventRecord(row);
	} catch (err) {
		// Unique externalId per connection → treat as idempotent ignore
		const code =
			err && typeof err === "object" && "code" in err
				? String((err as { code?: unknown }).code ?? "")
				: "";
		if (code === "P2002" || err instanceof Prisma.PrismaClientKnownRequestError) {
			const existing = await prisma.itsmEvent.findFirst({
				where: {
					connectionId: input.connectionId,
					externalId: input.externalId ?? undefined,
				},
			});
			if (existing) return toEventRecord(existing);
		}
		throw err;
	}
}

export async function testItsmConnection(
	id: string,
	message?: string,
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<{ ok: boolean; event: ItsmEventRecord; error?: string }> {
	const row = await prisma.itsmConnection.findFirst({
		where: { id, ...(session ? teamWhere(session) : {}) },
	});
	if (!row) throw new NotFoundError("ITSM connection not found");
	if (!row.enabled) throw new ValidationError("Connection is disabled");
	if (!supportsOutbound(row.direction)) {
		throw new ValidationError("Connection does not support outbound delivery");
	}

	const config = parseConfig(row.config);
	const credentials = decryptCredentials(row.credentialsEnc);
	assertOutboundReady(row.provider as ItsmProvider, config, credentials);

	const payload = {
		ticketId: "test",
		title: "ITSM connectivity test",
		description: message?.trim() || "VControlHub ITSM outbound test ping",
		status: "OPEN",
		priority: "NORMAL",
		eventType: "connection.test",
	};

	const delivery = await deliverOutbound({
		provider: row.provider as ItsmProvider,
		config,
		credentials,
		payload,
	});

	const event = await recordEvent({
		connectionId: row.id,
		direction: "outbound",
		eventType: "connection.test",
		ticketId: null,
		status: delivery.ok ? "ok" : "error",
		payload: {
			message: payload.description,
			statusCode: delivery.statusCode ?? null,
			responseBody: delivery.responseBody ?? null,
		},
		errorMessage: delivery.ok ? null : delivery.error ?? "delivery failed",
	});

	await prisma.itsmConnection.update({
		where: { id: row.id },
		data: {
			lastOutboundAt: new Date(),
			lastError: delivery.ok ? null : delivery.error ?? "delivery failed",
		},
	});

	return {
		ok: delivery.ok,
		event,
		error: delivery.ok ? undefined : delivery.error,
	};
}

export async function fanOutTicketEvent(input: {
	ticketId: string;
	eventType: string;
	title: string;
	description: string;
	status: string;
	priority: string;
	category?: string | null;
	commentBody?: string;
	/** When set, only fan out to connections for this team (plus unassigned). */
	teamId?: string | null;
}): Promise<{ sent: number; failed: number }> {
	// Multi-tenant: never fan out a ticket event to every connection in the fleet.
	// - ticket has teamId → that team's connections + shared (teamId null)
	// - ticket has no teamId → only shared connections (teamId null)
	const connections = await prisma.itsmConnection.findMany({
		where: {
			enabled: true,
			...(input.teamId
				? { OR: [{ teamId: input.teamId }, { teamId: null }] }
				: { teamId: null }),
		},
		take: 50,
	});
	let sent = 0;
	let failed = 0;

	for (const row of connections) {
		if (!supportsOutbound(row.direction)) continue;
		const config = parseConfig(row.config);
		const credentials = decryptCredentials(row.credentialsEnc);
		try {
			assertOutboundReady(row.provider as ItsmProvider, config, credentials);
		} catch (err) {
			failed += 1;
			const msg = err instanceof Error ? err.message : "not ready";
			await recordEvent({
				connectionId: row.id,
				direction: "outbound",
				eventType: input.eventType,
				ticketId: input.ticketId,
				status: "error",
				errorMessage: msg,
			});
			await prisma.itsmConnection.update({
				where: { id: row.id },
				data: { lastError: msg },
			});
			continue;
		}

		const delivery = await deliverOutbound({
			provider: row.provider as ItsmProvider,
			config,
			credentials,
			payload: {
				ticketId: input.ticketId,
				title: input.title,
				description: input.description,
				status: input.status,
				priority: input.priority,
				category: input.category,
				eventType: input.eventType,
				commentBody: input.commentBody,
			},
		});

		await recordEvent({
			connectionId: row.id,
			direction: "outbound",
			eventType: input.eventType,
			ticketId: input.ticketId,
			status: delivery.ok ? "ok" : "error",
			payload: {
				statusCode: delivery.statusCode ?? null,
				responseBody: delivery.responseBody ?? null,
			},
			errorMessage: delivery.ok ? null : delivery.error ?? "delivery failed",
		});

		await prisma.itsmConnection.update({
			where: { id: row.id },
			data: {
				lastOutboundAt: new Date(),
				lastError: delivery.ok ? null : delivery.error ?? "delivery failed",
			},
		});

		if (delivery.ok) sent += 1;
		else failed += 1;
	}

	if (sent + failed > 0) {
		logger.info("ticket event fan-out complete", {
			ticketId: input.ticketId,
			eventType: input.eventType,
			sent,
			failed,
		});
	}
	return { sent, failed };
}

function normalizeStatus(raw: string | null): string | null {
	if (!raw) return null;
	const upper = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
	const map: Record<string, string> = {
		OPEN: "OPEN",
		IN_PROGRESS: "IN_PROGRESS",
		INPROGRESS: "IN_PROGRESS",
		RESOLVED: "RESOLVED",
		CLOSED: "CLOSED",
		CLOSE: "CLOSED",
	};
	return map[upper] ?? null;
}

function normalizePriority(raw: string | null | undefined, fallback = "NORMAL"): string {
	if (!raw) return fallback;
	const upper = raw.trim().toUpperCase();
	if (upper === "MEDIUM") return "NORMAL";
	if (["LOW", "NORMAL", "HIGH", "URGENT"].includes(upper)) return upper;
	return fallback;
}

export async function handleInboundWebhook(input: {
	connectionId: string;
	rawBody: string;
	signatureHeader: string | null;
	json: Record<string, unknown>;
	systemUserId: string;
}): Promise<{
	event: ItsmEventRecord;
	ticketId: string | null;
	action: string;
}> {
	const row = await prisma.itsmConnection.findUnique({ where: { id: input.connectionId } });
	if (!row) throw new NotFoundError("ITSM connection not found");
	if (!row.enabled) throw new ValidationError("Connection is disabled");
	if (!supportsInbound(row.direction)) {
		throw new ValidationError("Connection does not accept inbound events");
	}

	const credentials = decryptCredentials(row.credentialsEnc);
	const config = parseConfig(row.config);
	const secret = credentials.webhookSecret ?? credentials.signingSecret;

	// Require signature for all inbound-capable connections that have a secret configured.
	// If no secret is stored, reject (no open unauthenticated inbound).
	const verified = verifyInboundSignature({
		rawBody: input.rawBody,
		headerSignature: input.signatureHeader,
		secret,
	});
	if (!verified.ok) {
		await recordEvent({
			connectionId: row.id,
			direction: "inbound",
			eventType: "security.rejected",
			status: "error",
			payload: { reason: verified.error },
			errorMessage: verified.error,
		});
		await prisma.itsmConnection.update({
			where: { id: row.id },
			data: { lastError: verified.error },
		});
		throw new ForbiddenError(verified.error);
	}

	const normalized = normalizeInboundTicket(input.json);
	const eventType = normalized.eventType;
	let ticketId = normalized.ticketId;
	let action = "ignored";

	try {
		if (normalized.commentBody && ticketId) {
			// Inbound comments must target a ticket that already belongs to this
			// connection's team (or shared null-team). Prevents signed webhooks from
			// writing into another tenant's ticket by id.
			const commentTarget = await prisma.ticket.findFirst({
				where: {
					id: ticketId,
					...(row.teamId
						? { OR: [{ teamId: row.teamId }, { teamId: null }] }
						: {}),
				},
				select: { id: true },
			});
			if (!commentTarget) {
				throw new NotFoundError("Ticket not found for this connection team");
			}
			await addTicketComment({
				ticketId,
				authorId: input.systemUserId,
				body: `[ITSM inbound] ${normalized.commentBody}`,
				skipItsmFanOut: true,
			});
			action = "comment";
		} else if (
			(eventType.includes("create") || !ticketId) &&
			config.createOnInbound !== false &&
			normalized.title
		) {
			const ticket = await createTicket({
				title: normalized.title,
				description: normalized.description || normalized.title,
				priority: normalizePriority(normalized.priority ?? config.defaultPriority),
				category: normalized.category ?? config.defaultCategory,
				createdBy: input.systemUserId,
				skipItsmFanOut: true,
				// Stamp connection team so inbound tickets are not teamId=null legacy/shared
				session: row.teamId ? { currentTeamId: row.teamId } : undefined,
			});
			ticketId = ticket.id;
			action = "create";
		} else if (ticketId && normalized.status) {
			const status = normalizeStatus(normalized.status);
			if (status) {
				const statusTarget = await prisma.ticket.findFirst({
					where: {
						id: ticketId,
						...(row.teamId
							? { OR: [{ teamId: row.teamId }, { teamId: null }] }
							: {}),
					},
					select: { id: true },
				});
				if (!statusTarget) {
					throw new NotFoundError("Ticket not found for this connection team");
				}
				await updateTicketStatus({ id: ticketId, status, skipItsmFanOut: true });
				action = "status_update";
			} else {
				action = "ignored_status";
			}
		} else if (ticketId) {
			action = "acknowledged";
		} else {
			action = "ignored_no_ticket";
		}

		const event = await recordEvent({
			connectionId: row.id,
			direction: "inbound",
			eventType,
			ticketId,
			status: action.startsWith("ignored") ? "ignored" : "ok",
			externalId: normalized.externalId,
			payload: {
				action,
				title: normalized.title,
				status: normalized.status,
			},
		});

		await prisma.itsmConnection.update({
			where: { id: row.id },
			data: {
				lastInboundAt: new Date(),
				lastError: null,
			},
		});

		return { event, ticketId, action };
	} catch (err) {
		const message = err instanceof Error ? err.message : "inbound processing failed";
		// Persist failure for audit/UI, then rethrow so the public route returns non-2xx
		// (HTTP 200 + action:error looked like acceptance to status-code-only senders).
		await recordEvent({
			connectionId: row.id,
			direction: "inbound",
			eventType,
			ticketId,
			status: "error",
			externalId: normalized.externalId,
			payload: { action: "error" },
			errorMessage: message,
		});
		await prisma.itsmConnection.update({
			where: { id: row.id },
			data: {
				lastInboundAt: new Date(),
				lastError: message,
			},
		});
		logger.error("inbound webhook processing failed", err, {
			connectionId: row.id,
			eventType,
		});
		throw err instanceof Error ? err : new Error(message);
	}
}

/** Best-effort outbound fan-out after ticket mutations (never throws to callers). */
export async function safeFanOutTicketEvent(
	input: Parameters<typeof fanOutTicketEvent>[0],
): Promise<void> {
	try {
		await fanOutTicketEvent(input);
	} catch (err) {
		logger.error("ticket fan-out failed", err, {
			ticketId: input.ticketId,
			eventType: input.eventType,
		});
	}
}
