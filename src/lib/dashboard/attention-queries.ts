import { Prisma } from "@prisma/client";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { rawServerScope, rawTeamScope, seesAllCustomers, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
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
	const [latest] = await prisma.$queryRaw<{ count: number; source: string; title: string; taskType: string | null; updatedAt: Date }[]>`
		WITH failures AS (
			SELECT t.id, t."updatedAt", 'job' AS source, t.title, t.type AS "taskType"
			FROM jobs t WHERE t.status = 'FAILED' ${customer} ${owner}
			UNION ALL
			SELECT t.id, t."updatedAt", CASE WHEN s.id IS NULL THEN 'command' ELSE 'scheduled' END, coalesce(s.name,t.title), NULL
			FROM command_requests t LEFT JOIN scheduled_task_runs run ON run."commandRequestId" = t.id
			LEFT JOIN scheduled_tasks s ON s.id = run."scheduledTaskId"
			WHERE t.status IN ('FAILED','REJECTED') ${customer} ${requester}
			UNION ALL
			SELECT t.id, t."updatedAt", 'download', coalesce(nullif(t."fileName",''),t.url), NULL
			FROM download_tasks t WHERE t.status = 'FAILED' ${customer} ${owner}
			UNION ALL
			SELECT t.id, t."updatedAt", 'sync', t.name, NULL
			FROM sync_jobs t WHERE t.status = 'ERROR' ${customer} ${owner}
			UNION ALL
			SELECT t.id, t."updatedAt", 'backup', t.type::text || ' backup', t.type::text
			FROM backup_records t WHERE t.status IN ('FAILED','REJECTED','EXPIRED','ERROR') ${customer} ${owner}
			UNION ALL
			SELECT t.id, coalesce(c."updatedAt",t."updatedAt"), 'deployment', tpl.name, NULL
			FROM deployment_runs t JOIN command_templates tpl ON tpl.id = t."templateId"
			LEFT JOIN command_requests c ON c.id = t."commandRequestId"
			WHERE coalesce(c.status::text,t.status) IN ('FAILED','REJECTED','EXPIRED','ERROR') ${customer} ${owner}
		)
		SELECT count(*) OVER ()::int AS count, source, title, "taskType", "updatedAt"
		FROM failures WHERE "updatedAt" BETWEEN ${since} AND ${now}
		ORDER BY "updatedAt" DESC, source, id LIMIT 1
	`;
	return { count: latest?.count ?? 0, latest };
}
