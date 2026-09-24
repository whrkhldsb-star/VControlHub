import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * GET  /api/servers/[id]/vps-backup/schedules — list VPS backup schedules
 * POST /api/servers/[id]/vps-backup/schedules — create a VPS backup schedule
 *
 * TR-043: VPS remote backup schedule management.
 */

import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import {
	listVpsBackupSchedules,
	createVpsBackupSchedule,
} from "@/lib/backup/vps-backup-schedule-service";
import { NotFoundError, AppError, isAppError } from "@/lib/errors";
import { VALID_PRESET_TYPES } from "@/lib/backup/vps-backup-presets";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

const createSchema = z.object({
	name: z.string().min(1).max(100),
	cronExpression: z.string().min(1).max(100),
	backupType: z.enum(VALID_PRESET_TYPES as [string, ...string[]]),
	paths: z.array(z.string().max(500)).max(20).optional(),
	note: z.string().max(500).optional(),
	retentionDays: z.number().int().min(1).max(365).optional(),
});

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id: serverId } = await params;
	return withApiRoute(
		request,
		{ permission: "server:read", rateLimit: GENERAL_WRITE_LIMIT },
		async ({ session }) => {
			const teamAccess = await assertServerTeamAccess(session, serverId);
			if (!teamAccess.ok) return teamAccess.response;

			const server = await prisma.server.findUnique({
				where: { id: serverId },
				select: { id: true },
			});
			if (!server) {
				throw new NotFoundError(apiCopy("apiCopy.server.not.found.d7783f94"));
			}

			const schedules = await listVpsBackupSchedules(serverId);
			return Response.json({ schedules });
		},
	);
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id: serverId } = await params;
	return withApiRoute(
		request,
		{
			permission: "server:write",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: createSchema,
		},
		async ({ session, body }) => {
			const teamAccess = await assertServerTeamAccess(session, serverId);
			if (!teamAccess.ok) return teamAccess.response;

			const server = await prisma.server.findUnique({
				where: { id: serverId },
				select: { id: true, name: true },
			});
			if (!server) {
				throw new NotFoundError(apiCopy("apiCopy.server.not.found.d7783f94"));
			}

			// Service AppErrors (invalid cron / custom paths → ValidationError)
			// keep their own 4xx status; anything else is rethrown as a typed
			// error so the guard serves the localized 500 copy.
			const locale = await getServerLocale();
			let schedule: Awaited<ReturnType<typeof createVpsBackupSchedule>>;
			try {
				schedule = await createVpsBackupSchedule({
					serverId,
					...body,
					createdById: session.userId,
				});
			} catch (error) {
				if (isAppError(error)) throw error;
				throw new AppError({ code: "INTERNAL_ERROR", message: t("vpsBackupApi.errorCreateFailed", locale), status: 500, cause: error });
			}

			await auditUserAction(
				session.userId,
				"vps-backup.schedule.create",
				{ serverId, scheduleId: schedule.id, name: body.name },
				undefined, session.currentTeamId);

			return Response.json({ schedule }, { status: 201 });
		},
	);
}
