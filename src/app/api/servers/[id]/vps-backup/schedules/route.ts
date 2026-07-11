/**
 * GET  /api/servers/[id]/vps-backup/schedules — list VPS backup schedules
 * POST /api/servers/[id]/vps-backup/schedules — create a VPS backup schedule
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
	listVpsBackupSchedules,
	createVpsBackupSchedule,
} from "@/lib/backup/vps-backup-schedule-service";
import { VALID_PRESET_TYPES } from "@/lib/backup/vps-backup-presets";

export const dynamic = "force-dynamic";
const logger = createLogger("api:servers:vps-backup:schedules");

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
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT },
		async ({ session }) => {
			if (!session || !sessionHasPermission(session, "server:read")) {
				return Response.json({ error: "Forbidden" }, { status: 403 });
			}

			const server = await prisma.server.findUnique({
				where: { id: serverId },
				select: { id: true },
			});
			if (!server) {
				return Response.json({ error: "Server not found" }, { status: 404 });
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
			requireAuth: true,
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: createSchema,
		},
		async ({ session, body }) => {
			const locale = await getServerLocale();
			if (!session || !sessionHasPermission(session, "server:write")) {
				return Response.json(
					{ error: t("vpsBackupApi.errorForbidden", locale) },
					{ status: 403 },
				);
			}

			const server = await prisma.server.findUnique({
				where: { id: serverId },
				select: { id: true, name: true },
			});
			if (!server) {
				return Response.json({ error: "Server not found" }, { status: 404 });
			}

			try {
				const schedule = await createVpsBackupSchedule({
					serverId,
					...body,
					createdById: session.userId,
				});

				await auditUserAction(
					session.userId,
					"vps-backup.schedule.create",
					{ serverId, scheduleId: schedule.id, name: body.name },
				);

				return Response.json({ schedule }, { status: 201 });
			} catch (err) {
				logger.error("Failed to create VPS backup schedule", { error: err, serverId });
				return Response.json(
					{ error: t("vpsBackupApi.errorCreateFailed", locale) },
					{ status: 500 },
				);
			}
		},
	);
}
