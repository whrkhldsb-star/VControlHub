/**
 * DELETE /api/servers/[id]/vps-backup/records/[recordId] — delete a VPS backup record + local file
 *
 * TR-043: VPS remote backup record management.
 */

import { auditUserAction } from "@/lib/audit/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createLogger } from "@/lib/logging";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { deleteVpsBackupRecord } from "@/lib/backup/vps-backup-service";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";
const logger = createLogger("api:servers:vps-backup:record");

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string; recordId: string }> },
) {
	const { id: serverId, recordId } = await params;
	return withApiRoute(
		request,
		{ permission: "server:write", rateLimit: GENERAL_WRITE_LIMIT },
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

			const existing = await prisma.vpsBackupRecord.findFirst({
				where: { id: recordId, serverId },
				select: { id: true },
			});
			if (!existing) {
				return Response.json({ error: "Record not found" }, { status: 404 });
			}

			try {
				await deleteVpsBackupRecord(recordId);
				await auditUserAction(session.userId, "vps-backup.record.delete", { serverId, recordId }, undefined, session?.currentTeamId);
				return Response.json({ success: true });
			} catch (err) {
				logger.error("Failed to delete VPS backup record", { error: err, recordId });
				return Response.json(
					{ error: t("vpsBackupApi.errorDeleteRecordFailed", locale) },
					{ status: 500 },
				);
			}
		},
	);
}
