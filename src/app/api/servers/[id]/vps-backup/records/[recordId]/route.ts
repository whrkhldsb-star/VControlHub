import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * DELETE /api/servers/[id]/vps-backup/records/[recordId] — delete a VPS backup record + local file
 *
 * TR-043: VPS remote backup record management.
 */

import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { NotFoundError, ConflictError } from "@/lib/errors";
import { deleteVpsBackupRecord } from "@/lib/backup/vps-backup-service";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { getErrorMessage } from "@/lib/http/error-message";

export const dynamic = "force-dynamic";

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string; recordId: string }> },
) {
	const { id: serverId, recordId } = await params;
	return withApiRoute(
		request,
		{ permission: "server:write", rateLimit: GENERAL_WRITE_LIMIT },
		async ({ session }) => {
			const teamAccess = await assertServerTeamAccess(session, serverId);
			if (!teamAccess.ok) return teamAccess.response;

			const existing = await prisma.vpsBackupRecord.findFirst({
				where: { id: recordId, serverId },
				select: { id: true },
			});
			if (!existing) {
				throw new NotFoundError(apiCopy("apiCopy.record.not.found.60de363f"));
			}

			try {
				await deleteVpsBackupRecord(recordId);
			} catch (err) {
				const message = getErrorMessage(err, String(err));
				// RUNNING delete is a conflict/business rule, not an internal
				// failure; the service raises it as a plain Error.
				if (/RUNNING/i.test(message)) {
					throw new ConflictError(message);
				}
				throw err;
			}
			await auditUserAction(session.userId, "vps-backup.record.delete", { serverId, recordId }, undefined, session.currentTeamId);
			return Response.json({ success: true });
		},
	);
}
