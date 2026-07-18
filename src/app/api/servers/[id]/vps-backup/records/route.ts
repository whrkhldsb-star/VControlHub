/**
 * GET  /api/servers/[id]/vps-backup/records — list VPS backup records
 * POST /api/servers/[id]/vps-backup/records — trigger a manual backup
 *
 * TR-043: VPS remote backup records + manual trigger.
 */

import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createLogger } from "@/lib/logging";
import { enqueueJob } from "@/lib/job/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import {
	listVpsBackupRecords,
	createVpsBackupRecord,
	VPS_BACKUP_CREATE_JOB_TYPE,
} from "@/lib/backup/vps-backup-service";
import { VALID_PRESET_TYPES } from "@/lib/backup/vps-backup-presets";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";
const logger = createLogger("api:servers:vps-backup:records");

const triggerSchema = z.object({
	backupType: z.enum(VALID_PRESET_TYPES as [string, ...string[]]),
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

   const teamAccess = await assertServerTeamAccess(session, serverId);
   if (!teamAccess.ok) return teamAccess.response;

			const server = await prisma.server.findUnique({
				where: { id: serverId },
				select: { id: true },
			});
			if (!server) {
				return Response.json({ error: "Server not found" }, { status: 404 });
			}

			const records = await listVpsBackupRecords(serverId);
			return Response.json({ records });
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
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, bodySchema: triggerSchema },
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

			const server = await prisma.server.findUnique({
				where: { id: serverId },
				select: { id: true, name: true, enabled: true },
			});
			if (!server) {
				return Response.json({ error: "Server not found" }, { status: 404 });
			}
			if (!server.enabled) {
				return Response.json(
					{ error: t("vpsBackupApi.errorServerDisabled", locale) },
					{ status: 400 },
				);
			}

			try {
				const { id: recordId } = await createVpsBackupRecord({
					serverId,
					backupType: body.backupType,
					createdBy: session.userId,
				});

				await enqueueJob({
					type: VPS_BACKUP_CREATE_JOB_TYPE,
					title: `VPS backup: ${body.backupType} (${server.name})`,
					payload: { recordId },
				});

				await auditUserAction(
					session.userId,
					"vps-backup.record.trigger",
					{ serverId, recordId, backupType: body.backupType },
				undefined, session?.currentTeamId);

				return Response.json({ recordId, status: "PENDING" }, { status: 202 });
			} catch (err) {
				logger.error("Failed to trigger VPS backup", { error: err, serverId });
				return Response.json(
					{ error: t("vpsBackupApi.errorTriggerFailed", locale) },
					{ status: 500 },
				);
			}
		},
	);
}
