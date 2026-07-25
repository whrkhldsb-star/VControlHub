/**
 * GET /api/servers/[id]/vps-backup/records/[recordId]/download — download a VPS backup archive
 *
 * TR-043: VPS remote backup file download.
 * Streams the local .tar.gz file to the client.
 */

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createLogger } from "@/lib/logging";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { resolveVpsBackupFilePath } from "@/lib/backup/vps-backup-service";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";
const logger = createLogger("api:servers:vps-backup:download");

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string; recordId: string }> },
) {
	const { id: serverId, recordId } = await params;
	return withApiRoute(
		request,
		{ permission: "server:read", rateLimit: GENERAL_WRITE_LIMIT },
		async ({ session }) => {
			const locale = await getServerLocale();

			const teamAccess = await assertServerTeamAccess(session, serverId);
			if (!teamAccess.ok) return teamAccess.response;

			const record = await prisma.vpsBackupRecord.findFirst({
				where: { id: recordId, serverId },
				select: { id: true, localPath: true, backupType: true, status: true },
			});
			if (!record) {
				return Response.json({ error: "Record not found" }, { status: 404 });
			}
			if (record.status !== "COMPLETED" || !record.localPath) {
				return Response.json(
					{ error: t("vpsBackupApi.errorNotCompleted", locale) },
					{ status: 400 },
				);
			}

			const absPath = resolveVpsBackupFilePath(record.localPath);

			try {
				const { createReadStream, statSync } = await import("node:fs");
				const stat = statSync(absPath);
				const stream = createReadStream(absPath);
				const filename = `${record.backupType}-${recordId}.tar.gz`;

				// nodeStreamToWeb wires cancel() → stream.destroy() so client aborts
				// free the fd instead of reading to EOF (cast-as-WebStream does not).
				return new Response(nodeStreamToWeb(stream), {
					headers: {
						"Content-Type": "application/gzip",
						"Content-Disposition": `attachment; filename="${filename}"`,
						"Content-Length": stat.size.toString(),
					},
				});
			} catch (err) {
				logger.error("Failed to stream VPS backup file", { error: err, recordId });
				return Response.json(
					{ error: t("vpsBackupApi.errorFileNotFound", locale) },
					{ status: 404 },
				);
			}
		},
	);
}
