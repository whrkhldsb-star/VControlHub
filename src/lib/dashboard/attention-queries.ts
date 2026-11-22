import { manualRunKeyPrefix, manualRunPrefix } from "@/lib/command/approval-identity";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { Prisma } from "@prisma/client";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { commandRequestTeamWhere, rawServerScope, rawTeamScope, seesAllCustomers, serverTeamWhere, teamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { resolveTaskDrive } from "@/lib/downloads/destination";
import { canAccessDownloadTask } from "@/lib/downloads/route-helpers";
import { syncVisibility, visibleSyncPaths } from "@/lib/sync/service-crud";
import { maySelfReviewCommands } from "@/lib/command/review-scope";
import { FAILED_TASK_WINDOW_MS } from "./attention";

export async function openIncidentSummary(session: TeamSession) {
	const teamId = session.currentTeamId;
	if (!teamId && !seesAllCustomers(session)) return { count: 0, latest: undefined };
	const scope = teamId ? Prisma.sql`AND (
		(i."serverId" IS NULL AND r."teamId" = ${teamId}) OR
		((r."teamId" = ${teamId} OR r."teamId" IS NULL) AND EXISTS (
			SELECT 1 FROM servers s WHERE s.id = i."serverId" AND (${rawServerScope(session, "canRead")})
		))
	)` : Prisma.empty;
	const [latest] = await prisma.$queryRaw<{ count: number; title: string; metric: string; serverName: string }[]>`
		SELECT count(*) OVER ()::int AS count, i.title, i.metric, i."serverName"
		FROM alert_incidents i LEFT JOIN alert_rules r ON r.id = i."ruleId"
		WHERE i.status = 'OPEN' ${scope} ORDER BY i."createdAt" DESC, i.id LIMIT 1
	`;
	return { count: latest?.count ?? 0, latest };
}

/** The task centre's six sources and owner scope. A deployment follows its linked command's outcome. */
export async function failedTaskSummary(session: TeamSession, now: Date) {
	const customer = Prisma.sql`AND ${rawTeamScope(session, Prisma.sql`t."teamId"`)}`;
	const teamTasks = sessionHasPermission(session, "team:manage");
	const owner = teamTasks ? Prisma.empty : Prisma.sql`AND t."createdBy" = ${session.userId}`;
	const requester = teamTasks ? Prisma.empty : Prisma.sql`AND t."requesterId" = ${session.userId}`;
	const since = new Date(now.getTime() - FAILED_TASK_WINDOW_MS);
	const [latest] = await prisma.$queryRaw<{ id: string; count: number; source: string; title: string; taskType: string | null; updatedAt: Date }[]>`
		WITH failures AS (
			SELECT t.id, t."updatedAt", 'job' AS source, t.title, t.type AS "taskType"
			FROM jobs t WHERE t.status = 'FAILED' ${customer} ${owner}
			UNION ALL
			SELECT t.id, t."updatedAt", CASE WHEN s.id IS NULL THEN 'command' ELSE 'scheduled' END, coalesce(s.name,t.title), NULL
			FROM command_requests t LEFT JOIN scheduled_task_runs run ON run."commandRequestId" = t.id
			LEFT JOIN scheduled_tasks s ON s.id = run."scheduledTaskId"
			WHERE t.status IN ('FAILED','REJECTED') ${customer} ${requester}
			UNION ALL
			SELECT t.id, t."updatedAt", 'backup', t.type::text || ' backup', t.type::text
			FROM backup_records t WHERE t.status IN ('FAILED','REJECTED','EXPIRED','ERROR') ${customer} ${owner}
			UNION ALL
			SELECT t.id, coalesce(c."updatedAt",t."updatedAt"), 'deployment', tpl.name, NULL
			FROM deployment_runs t JOIN command_templates tpl ON tpl.id = t."templateId"
			LEFT JOIN command_requests c ON c.id = t."commandRequestId"
			WHERE coalesce(c.status::text,t.status) IN ('FAILED','REJECTED','EXPIRED','ERROR') ${customer} ${owner}
		)
		SELECT count(*) OVER ()::int AS count, id, source, title, "taskType", "updatedAt"
		FROM failures WHERE "updatedAt" BETWEEN ${since} AND ${now}
		ORDER BY "updatedAt" DESC, source, id LIMIT 1
	`;
	let count = latest?.count ?? 0;
	let newest = latest;
	if (sessionHasPermission(session, "storage:read")) {
		const scope = { ...teamWhere(session), ...(!teamTasks && { createdBy: session.userId }), updatedAt: { gte: since, lte: now } };
		const drive = { select: { id: true, basePath: true } } as const;
		const observe = (id: string, updatedAt: Date, source: string, title: string) => {
			count++;
			if (!newest || updatedAt > newest.updatedAt || (updatedAt.getTime() === newest.updatedAt.getTime() &&
				(source < newest.source || (source === newest.source && id < newest.id)))) {
				newest = { id, updatedAt, source, title, taskType: null, count: 1 };
			}
		};
		for (let after: string | undefined; ;) {
			const rows = await prisma.downloadTask.findMany({
				where: { ...scope, status: "FAILED", server: serverTeamWhere(session), ...(after && { id: { gt: after } }) },
				select: { id: true, updatedAt: true, fileName: true, targetPath: true, agentStorageNodeId: true, directStorageNodeId: true,
					server: { select: { storageNode: drive, agentFileShares: { select: { node: drive } } } } },
				take: 100, orderBy: { id: "asc" },
			});
			const allowed = await Promise.all(rows.map(row => canAccessDownloadTask({
				task: resolveTaskDrive(row), session: { ...session, username: "", mustChangePassword: false }, operation: "read",
			})));
			rows.forEach((row, index) => { if (allowed[index]) observe(row.id, row.updatedAt, "download", row.fileName || row.id); });
			if (rows.length < 100) break;
			after = rows.at(-1)!.id;
		}
		for (let after: string | undefined; ;) {
			const rows = await prisma.syncJob.findMany({ where: { AND: [scope, syncVisibility(session)], status: "ERROR", ...(after && { id: { gt: after } }) },
				select: { id: true, updatedAt: true, name: true, sourceServerId: true, targetServerId: true, sourcePath: true, targetPath: true },
				take: 100, orderBy: { id: "asc" } });
			for (const row of rows.filter(await visibleSyncPaths(rows, session))) observe(row.id, row.updatedAt, "sync", row.name);
			if (rows.length < 100) break;
			after = rows.at(-1)!.id;
		}
	}
	return { count, latest: newest };
}

export async function dashboardCommands(session: TeamSession) {
	const scope = commandRequestTeamWhere(session);
	const pending = { ...scope, status: "PENDING_APPROVAL" as const };
	const review: Prisma.CommandRequestWhereInput = maySelfReviewCommands(session) ? pending : {
		AND: [
			pending,
			{ requesterId: { not: session.userId } },
			{ OR: [{ idempotencyKey: null }, { NOT: { idempotencyKey: { startsWith: escapeLikeLiteral(manualRunPrefix(session.userId)) } } }] },
			// Older manual requests have no recorded initiator. Only team managers can review them.
			{ OR: [{ scheduledTaskRuns: { none: { manual: true } } }, { idempotencyKey: { startsWith: manualRunKeyPrefix } }] },
		],
	};
	const canReadServers = sessionHasPermission(session, "server:read");
	const orderBy = [{ createdAt: "desc" }, { id: "desc" }] satisfies Prisma.CommandRequestOrderByWithRelationInput[];
	return prisma.$transaction(async tx => {
		const pendingApprovals = await tx.commandRequest.count({ where: pending });
		const reviewCount = await tx.commandRequest.count({ where: review });
		const latest = await tx.commandRequest.findFirst({ where: review, orderBy, select: { title: true } });
		const rows = await tx.commandRequest.findMany({ where: scope, orderBy, take: 5,
			select: { id: true, title: true, command: true, status: true, requesterId: true, teamId: true,
				initiatedByType: true, requester: { select: { id: true, username: true, displayName: true } } } });
		const requests = await Promise.all(rows.map(async row => ({ ...row, isAssistantInitiated: row.initiatedByType === "ASSISTANT",
			targetCount: canReadServers ? await tx.commandTarget.count({ where: {
				commandRequestId: row.id, server: { AND: [serverTeamWhere(session), { teamId: row.teamId }] },
			} }) : 0 })));
		return { requests, pendingApprovals, review: { count: reviewCount, latest: latest?.title ?? null } };
	}, { isolationLevel: "RepeatableRead" });
}
