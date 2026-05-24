import { AuditSeverity, ActorType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

// Prisma 7 Json type compatibility — must be JSON-serializable values only
type PrismaJsonValue = string | number | boolean | null | { [key: string]: PrismaJsonValue } | PrismaJsonValue[];

type WriteAuditLogInput = {
 actorType: ActorType;
 actorId?: string;
 action: string;
 severity?: AuditSeverity;
 detail: Record<string, PrismaJsonValue>;
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

export async function listAuditLogs(
 input: ListAuditLogsInput = {},
): Promise<AuditLogListResult> {
 const page = Math.max(1, input.page ?? 1);
 const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
	const where: Record<string, unknown> = {};

	if (input.action) where.action = input.action;
	if (input.severity) where.severity = input.severity;
	if (input.actorId) where.actorId = input.actorId;
	if (input.search) {
		where.OR = [
			{ action: { contains: input.search, mode: "insensitive" } },
			{ actorType: { contains: input.search, mode: "insensitive" } },
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
	}

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

export async function getAuditStats(): Promise<{
 bySeverity: Record<string, number>;
 byAction: Record<string, number>;
 recentCount: number;
 total: number;
}> {
 const [total, recentCount] = await Promise.all([
 prisma.auditLog.count(),
 prisma.auditLog.count({
 where: {
 createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
 },
 }),
 ]);

 // Group by severity
 const severityGroups = await prisma.auditLog.groupBy({
 by: ["severity"],
 _count: true,
 });

 // Group by action (top 20)
 const actionGroups = await prisma.auditLog.groupBy({
 by: ["action"],
 _count: true,
 orderBy: { _count: { action: "desc" } },
 take: 20,
 });

 return {
 bySeverity: Object.fromEntries(
 severityGroups.map((g) => [g.severity, g._count]),
 ),
 byAction: Object.fromEntries(
 actionGroups.map((g) => [g.action, g._count]),
 ),
 recentCount,
 total,
 };
}

/** Convenience: log with USER actor type and fire-and-forget */
export function auditUserAction(
 actorId: string,
 action: string,
 detail: Record<string, PrismaJsonValue>,
 severity: AuditSeverity = "INFO",
): void {
writeAuditLog({ actorType: "USER", actorId, action, severity, detail }).catch(
 () => {}, // audit failure must not block caller or pollute production logs
);
}

/** Convenience: log with SYSTEM actor type and fire-and-forget */
export function auditSystemAction(
 action: string,
 detail: Record<string, PrismaJsonValue>,
 severity: AuditSeverity = "INFO",
): void {
writeAuditLog({ actorType: "SYSTEM", action, severity, detail }).catch(
 () => {}, // audit failure must not block caller or pollute production logs
);
}
