import { AuditSeverity, ActorType, Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

const ACTOR_TYPE_VALUES = new Set<ActorType>(["USER", "ASSISTANT", "SYSTEM"]);
const logger = createLogger("audit");

function normalizeActorTypeSearch(search: string): ActorType | null {
	const normalized = search.trim().toUpperCase();
	return ACTOR_TYPE_VALUES.has(normalized as ActorType) ? (normalized as ActorType) : null;
}

// Prisma 7 Json type compatibility — must be JSON-serializable values only
type PrismaJsonValue = string | number | boolean | null | { [key: string]: PrismaJsonValue } | PrismaJsonValue[];

type SessionScope = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

type WriteAuditLogInput = {
	actorType: ActorType;
	actorId?: string;
	action: string;
	severity?: AuditSeverity;
	detail: Record<string, PrismaJsonValue>;
	/** Optional team stamp for multi-tenant isolation (TR-030). */
	teamId?: string | null;
};

/**
 * Write an audit log entry. Fire-and-forget by design — callers should catch
 * failures so audit writes do not block the main operation.
 */
export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
	await prisma.auditLog.create({
		data: {
			actorType: input.actorType,
			actorId: input.actorId,
			action: input.action,
			severity: input.severity ?? "INFO",
			detail: input.detail as Prisma.InputJsonValue,
			...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
		},
	});
}

type ListAuditLogsInput = {
	page?: number;
	pageSize?: number;
	action?: string;
	severity?: string;
	actorId?: string;
	search?: string;
	/** When provided, list is filtered with teamWhere (admin sees all). */
	session?: SessionScope | null;
};

export type AuditLogEntry = {
	id: string;
	actorType: string;
	actorId: string | null;
	action: string;
	severity: string;
	detail: Record<string, PrismaJsonValue>;
	createdAt: Date;
	actor: { username: string; displayName: string | null } | null;
};

export type AuditLogListResult = {
	logs: AuditLogEntry[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
};

/**
 * Build Prisma where for audit list/export/stats.
 * Team filter is AND-composed so it never overwrites search `OR` clauses.
 */
function buildAuditWhere(input: {
	action?: string;
	severity?: string;
	actorId?: string;
	search?: string;
	session?: SessionScope | null;
	extra?: Record<string, unknown>;
}): Record<string, unknown> {
	const clauses: Record<string, unknown>[] = [];
	if (input.session) {
		const scope = teamWhere(input.session);
		if (Object.keys(scope).length > 0) {
			clauses.push(scope);
		}
	}
	if (input.action) clauses.push({ action: input.action });
	if (input.severity) clauses.push({ severity: input.severity });
	if (input.actorId) clauses.push({ actorId: input.actorId });
	if (input.search) {
		const searchClauses: Record<string, unknown>[] = [
			{ action: { contains: input.search, mode: "insensitive" } },
			{
				actor: {
					is: {
						OR: [
							{ username: { contains: input.search, mode: "insensitive" } },
							{ displayName: { contains: input.search, mode: "insensitive" } },
						],
					},
				},
			},
		];
		const actorType = normalizeActorTypeSearch(input.search);
		if (actorType) {
			searchClauses.push({ actorType });
		}
		clauses.push({ OR: searchClauses });
	}
	if (input.extra && Object.keys(input.extra).length > 0) {
		clauses.push(input.extra);
	}
	if (clauses.length === 0) return {};
	if (clauses.length === 1) return clauses[0]!;
	return { AND: clauses };
}

export async function listAuditLogs(
	input: ListAuditLogsInput = {},
): Promise<AuditLogListResult> {
	const page = Math.max(1, input.page ?? 1);
	const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
	const where = buildAuditWhere(input);

	const [logs, total] = await Promise.all([
		prisma.auditLog.findMany({
			where,
			include: {
				actor: { select: { username: true, displayName: true } },
			},
			orderBy: { createdAt: "desc" },
			skip: (page - 1) * pageSize,
			take: pageSize,
		}),
		prisma.auditLog.count({ where }),
	]);

	return {
		logs: logs as unknown as AuditLogEntry[],
		total,
		page,
		pageSize,
		totalPages: Math.ceil(total / pageSize),
	};
}

/**
 * Export: return all matching logs (no pagination) for CSV/JSON download.
 * Max 50 000 records — beyond that add date-range constraint in the caller.
 */
export async function exportAuditLogs(
	input: Omit<ListAuditLogsInput, "page" | "pageSize">,
): Promise<AuditLogEntry[]> {
	const MAX_EXPORT = 50_000;
	const where = buildAuditWhere(input);

	return (await prisma.auditLog.findMany({
		where,
		include: { actor: { select: { username: true, displayName: true } } },
		orderBy: { createdAt: "desc" },
		take: MAX_EXPORT,
	})) as unknown as AuditLogEntry[];
}

export async function getAuditStats(
	session?: SessionScope | null,
): Promise<{
	bySeverity: Record<string, number>;
	byAction: Record<string, number>;
	recentCount: number;
	total: number;
}> {
	const baseWhere = buildAuditWhere({ session });
	const recentWhere = buildAuditWhere({
		session,
		extra: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
	});

	const [total, recentCount, severityGroups, actionGroups] = await Promise.all([
		prisma.auditLog.count({ where: baseWhere }),
		prisma.auditLog.count({ where: recentWhere }),
		// Group by severity (team-scoped)
		prisma.auditLog.groupBy({
			by: ["severity"],
			where: baseWhere,
			_count: true,
		}),
		// Group by action (top 20, team-scoped)
		prisma.auditLog.groupBy({
			by: ["action"],
			where: baseWhere,
			_count: true,
			orderBy: { _count: { action: "desc" } },
			take: 20,
		}),
	]);

	return {
		bySeverity: Object.fromEntries(severityGroups.map((g) => [g.severity, g._count])),
		byAction: Object.fromEntries(actionGroups.map((g) => [g.action, g._count])),
		recentCount,
		total,
	};
}

/** Convenience: persist a USER audit record before the caller completes. */
export async function auditUserAction(
	actorId: string,
	action: string,
	detail: Record<string, PrismaJsonValue>,
	severity: AuditSeverity = "INFO",
	teamId?: string | null,
): Promise<void> {
	try {
		await writeAuditLog({ actorType: "USER", actorId, action, severity, detail, teamId });
	} catch (err) {
		logger.error("audit write failed", err, { action, actorId });
	}
}

/** Convenience: persist a SYSTEM audit record before the caller completes. */
export async function auditSystemAction(
	action: string,
	detail: Record<string, PrismaJsonValue>,
	severity: AuditSeverity = "INFO",
	teamId?: string | null,
): Promise<void> {
	try {
		await writeAuditLog({ actorType: "SYSTEM", action, severity, detail, teamId });
	} catch (err) {
		logger.error("audit write failed", err, { action });
	}
}
