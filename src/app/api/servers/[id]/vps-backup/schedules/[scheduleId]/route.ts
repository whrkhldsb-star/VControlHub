import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * PATCH  /api/servers/[id]/vps-backup/schedules/[scheduleId] — update schedule
 * DELETE /api/servers/[id]/vps-backup/schedules/[scheduleId] — delete schedule
 *
 * TR-043: VPS remote backup schedule management.
 */

import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { NotFoundError, AppError, isAppError } from "@/lib/errors";
import {
	updateVpsBackupSchedule,
	deleteVpsBackupSchedule,
} from "@/lib/backup/vps-backup-schedule-service";
import { VALID_PRESET_TYPES } from "@/lib/backup/vps-backup-presets";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	cronExpression: z.string().min(1).max(100).optional(),
	backupType: z.enum(VALID_PRESET_TYPES as [string, ...string[]]).optional(),
	paths: z.array(z.string().max(500)).max(20).optional(),
	note: z.string().max(500).optional(),
	retentionDays: z.number().int().min(1).max(365).nullable().optional(),
	status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string; scheduleId: string }> },
) {
	const { id: serverId, scheduleId } = await params;
	return withApiRoute(
		request,
		{ permission: "server:write", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: updateSchema },
		async ({ session, body }) => {
			const teamAccess = await assertServerTeamAccess(session, serverId);
			if (!teamAccess.ok) return teamAccess.response;

			// Service AppErrors (invalid cron → ValidationError) keep their own
			// 4xx status; anything else is rethrown as a typed error so the
			// guard serves the localized 500 copy.
			const locale = await getServerLocale();
			let updated: Awaited<ReturnType<typeof updateVpsBackupSchedule>>;
			try {
				updated = await updateVpsBackupSchedule(scheduleId, serverId, body);
			} catch (error) {
				if (isAppError(error)) throw error;
				throw new AppError({ code: "INTERNAL_ERROR", message: t("vpsBackupApi.errorUpdateFailed", locale), status: 500, cause: error });
			}
			await auditUserAction(session.userId, "vps-backup.schedule.update", { serverId, scheduleId }, undefined, session.currentTeamId);
			return Response.json({ schedule: updated });
		},
	);
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string; scheduleId: string }> },
) {
	const { id: serverId, scheduleId } = await params;
	return withApiRoute(
		request,
		{ permission: "server:write", rateLimit: GENERAL_WRITE_LIMIT },
		async ({ session }) => {
			const teamAccess = await assertServerTeamAccess(session, serverId);
			if (!teamAccess.ok) return teamAccess.response;

			const existing = await prisma.vpsBackupSchedule.findFirst({
				where: { id: scheduleId, serverId },
				select: { id: true },
			});
			if (!existing) {
				throw new NotFoundError(apiCopy("apiCopy.schedule.not.found.54f9551a"));
			}

			const locale = await getServerLocale();
			try {
				await deleteVpsBackupSchedule(scheduleId, serverId);
			} catch (error) {
				if (isAppError(error)) throw error;
				throw new AppError({ code: "INTERNAL_ERROR", message: t("vpsBackupApi.errorDeleteFailed", locale), status: 500, cause: error });
			}
			await auditUserAction(session.userId, "vps-backup.schedule.delete", { serverId, scheduleId }, undefined, session.currentTeamId);
			return Response.json({ success: true });
		},
	);
}
