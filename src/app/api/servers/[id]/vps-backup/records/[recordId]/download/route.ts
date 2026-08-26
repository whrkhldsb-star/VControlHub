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

/**
 * Stream a backup from offsite S3 when the local copy is missing. Returns a
 * download Response, or null when there is no usable offsite object (no key,
 * offsite disabled/misconfigured, or the object is gone) so the caller can
 * fall through to its 404.
 */
async function streamOffsiteFallback(
	offsiteKey: string | null,
	filename: string,
): Promise<Response | null> {
	if (!offsiteKey) return null;
	try {
		const { loadOffsiteConfig, validateOffsiteConfigForUse } = await import(
			"@/lib/storage/offsite/schema"
		);
		const { S3Client } = await import("@/lib/storage/offsite/s3-client");
		const offsiteConfig = await loadOffsiteConfig();
		if (!offsiteConfig.enabled) return null;
		if (validateOffsiteConfigForUse(offsiteConfig).length > 0) return null;

		const s3 = new S3Client(offsiteConfig);
		const object = await s3.getObject(offsiteKey);
		if (!object) return null;

		logger.info("serving VPS backup from offsite fallback", { offsiteKey });
		return new Response(object.body, {
			headers: {
				"Content-Type": "application/gzip",
				"Content-Disposition": `attachment; filename="${filename}"`,
				...(object.size ? { "Content-Length": object.size.toString() } : {}),
				// Signal this is the offsite copy so ops/telemetry can tell them apart.
				"X-VCH-Backup-Source": "offsite",
			},
		});
	} catch (err) {
		logger.error("offsite fallback download failed", {
			error: err instanceof Error ? err.message : String(err),
			offsiteKey,
		});
		return null;
	}
}

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
				select: { id: true, localPath: true, backupType: true, status: true, offsiteKey: true },
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

			const filename = `${record.backupType}-${recordId}.tar.gz`;
			const absPath = resolveVpsBackupFilePath(record.localPath);

			// Primary: stream the local copy.
			try {
				const { createReadStream, statSync } = await import("node:fs");
				const stat = statSync(absPath);
				const stream = createReadStream(absPath);

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
				// Local copy is gone (disk loss / manual cleanup) but the record is
				// COMPLETED. Fall back to the offsite object if one was uploaded,
				// instead of returning a dead 404.
				logger.warn("local VPS backup file unavailable; attempting offsite fallback", {
					recordId,
					error: err instanceof Error ? err.message : String(err),
				});
				const offsite = await streamOffsiteFallback(record.offsiteKey, filename);
				if (offsite) return offsite;
				logger.error("Failed to stream VPS backup file (no offsite fallback)", { error: err, recordId });
				return Response.json(
					{ error: t("vpsBackupApi.errorFileNotFound", locale) },
					{ status: 404 },
				);
			}
		},
	);
}
