/**
 * POST /api/servers/[id]/vps-backup/records/[recordId]/retry — re-run a FAILED
 * VPS backup.
 *
 * The status CAS only accepts PENDING→RUNNING, so a FAILED record can never be
 * re-run in place. Instead we create a fresh record that inherits the failed
 * one's backupType + paths (intent is persisted on the row precisely so retries
 * don't lose it) and enqueue a new backup job. No schema change required.
 */

import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createLogger } from "@/lib/logging";
import { enqueueJob } from "@/lib/job/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import {
	createVpsBackupRecord,
	VPS_BACKUP_CREATE_JOB_TYPE,
} from "@/lib/backup/vps-backup-service";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";
const logger = createLogger("api:servers:vps-backup:record:retry");

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string; recordId: string }> },
) {
	const { id: serverId, recordId } = await params;
	return withApiRoute(
		request,
		{ permission: "server:write", rateLimit: GENERAL_WRITE_LIMIT },
		async ({ session }) => {
			const locale = await getServerLocale();
			if (!session) {
				return Response.json(
					{ error: t("vpsBackupApi.errorForbidden", locale) },
					{ status: 403 },
				);
			}

			const teamAccess = await assertServerTeamAccess(session, serverId);
			if (!teamAccess.ok) return teamAccess.response;

			const server = await prisma.server.findUnique({
				where: { id: serverId },
				select: { id: true, name: true, enabled: true, teamId: true },
			});
			if (!server) {
				return Response.json(
					{ error: t("vpsBackupApi.errorServerNotFound", locale) },
					{ status: 404 },
				);
			}
			if (!server.enabled) {
				return Response.json(
					{ error: t("vpsBackupApi.errorServerDisabled", locale) },
					{ status: 400 },
				);
			}

			const original = await prisma.vpsBackupRecord.findFirst({
				where: { id: recordId, serverId },
				select: { id: true, status: true, backupType: true, paths: true },
			});
			if (!original) {
				return Response.json(
					{ error: t("vpsBackupApi.errorRecordNotFound", locale) },
					{ status: 404 },
				);
			}
			// Only FAILED records may be retried. RUNNING/PENDING are in flight;
			// COMPLETED has nothing to retry (trigger a new backup instead).
			if (original.status !== "FAILED") {
				return Response.json(
					{ error: t("vpsBackupApi.errorRetryNotFailed", locale) },
					{ status: 409 },
				);
			}

			try {
				const { id: newRecordId } = await createVpsBackupRecord({
					serverId,
					backupType: original.backupType,
					createdBy: session.userId,
					...(original.paths?.length ? { paths: original.paths } : {}),
				});

				try {
					await enqueueJob({
						type: VPS_BACKUP_CREATE_JOB_TYPE,
						title: `VPS backup retry: ${original.backupType} (${server.name})`,
						payload: {
							recordId: newRecordId,
							serverId,
							teamId: session.currentTeamId ?? server.teamId ?? null,
							...(original.paths?.length ? { paths: original.paths } : {}),
						},
						createdBy: session.userId,
						teamId: session.currentTeamId ?? server.teamId ?? null,
						maxAttempts: 1,
					});
				} catch (enqueueErr) {
					// Compensate the orphan PENDING row so the UI does not show a
					// second stuck backup when enqueue fails.
					await prisma.vpsBackupRecord
						.update({
							where: { id: newRecordId },
							data: {
								status: "FAILED",
								errorMessage:
									enqueueErr instanceof Error
										? enqueueErr.message
										: "Failed to enqueue VPS backup retry job",
								completedAt: new Date(),
							},
						})
						.catch(() => undefined);
					throw enqueueErr;
				}

				await auditUserAction(
					session.userId,
					"vps-backup.record.retry",
					{ serverId, originalRecordId: recordId, newRecordId, backupType: original.backupType },
					undefined,
					session.currentTeamId,
				);

				return Response.json({ recordId: newRecordId, status: "PENDING" }, { status: 202 });
			} catch (err) {
				logger.error("Failed to retry VPS backup", { error: err, serverId, recordId });
				return Response.json(
					{ error: t("vpsBackupApi.errorTriggerFailed", locale) },
					{ status: 500 },
				);
			}
		},
	);
}
