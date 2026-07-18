/**
 * PATCH  /api/servers/[id]/vps-backup/schedules/[scheduleId] — update schedule
 * DELETE /api/servers/[id]/vps-backup/schedules/[scheduleId] — delete schedule
 *
 * TR-043: VPS remote backup schedule management.
 */

import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createLogger } from "@/lib/logging";
import { getServerLocale, t } from "@/lib/i18n/translations";
import {
	updateVpsBackupSchedule,
	deleteVpsBackupSchedule,
} from "@/lib/backup/vps-backup-schedule-service";
import { VALID_PRESET_TYPES } from "@/lib/backup/vps-backup-presets";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";
const logger = createLogger("api:servers:vps-backup:schedule");

const updateSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	cronExpression: z.string().min(1).max(100).optional(),
	backupType: z.enum(VALID_PRESET_TYPES as [string, ...string[]]).optional(),
	paths: z.array(z.string().max(500)).max(20).optional(),
	note: z.string().max(500).optional(),
	retentionDays: z.number().int().min(1).max(365).optional(),
	status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string; scheduleId: string }> },
) {
	const { id: serverId, scheduleId } = await params;
	return withApiRoute(
		request,
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, bodySchema: updateSchema },
		async ({ session, body }) => {
			const locale = await getServerLocale();
			if (!session || !sessionHasPermission(session, "server:write")) {
				return Response.json(
					{ error: t("vpsBackupApi.errorForbidden", locale) },
					{ status: 403 },
				);
			}

			const teamAccess = await assertServerTeamAccess(session, serverId);
			if (!teamAccess.ok) return teamAccess.response;

			const existing = await prisma.vpsBackupSchedule.findFirst({
				where: { id: scheduleId, serverId },
				select: { id: true },
			});
			if (!existing) {
				return Response.json({ error: "Schedule not found" }, { status: 404 });
			}

			try {
				const updated = await updateVpsBackupSchedule(scheduleId, body);
				await auditUserAction(session.userId, "vps-backup.schedule.update", { serverId, scheduleId }, undefined, session?.currentTeamId);
				return Response.json({ schedule: updated });
			} catch (err) {
				logger.error("Failed to update VPS backup schedule", { error: err, scheduleId });
				return Response.json(
					{ error: t("vpsBackupApi.errorUpdateFailed", locale) },
					{ status: 500 },
				);
			}
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
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT },
		async ({ session }) => {
			const locale = await getServerLocale();
			if (!session || !sessionHasPermission(session, "server:write")) {
				return Response.json(
					{ error: t("vpsBackupApi.errorForbidden", locale) },
					{ status: 403 },
				);
			}

			const teamAccess = await assertServerTeamAccess(session, serverId);
			if (!teamAccess.ok) return teamAccess.response;

			const existing = await prisma.vpsBackupSchedule.findFirst({
				where: { id: scheduleId, serverId },
				select: { id: true },
			});
			if (!existing) {
				return Response.json({ error: "Schedule not found" }, { status: 404 });
			}

			try {
				await deleteVpsBackupSchedule(scheduleId);
				await auditUserAction(session.userId, "vps-backup.schedule.delete", { serverId, scheduleId }, undefined, session?.currentTeamId);
				return Response.json({ success: true });
			} catch (err) {
				logger.error("Failed to delete VPS backup schedule", { error: err, scheduleId });
				return Response.json(
					{ error: t("vpsBackupApi.errorDeleteFailed", locale) },
					{ status: 500 },
				);
			}
		},
	);
}
