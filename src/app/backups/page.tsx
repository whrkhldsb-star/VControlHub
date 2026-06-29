import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { buildBackupRestoreCommand, buildPortableBackupCommand, buildScheduledBackupCommand, formatBackupSize, isBackupType, listBackupRecords, summarizeBackupPolicy } from "@/lib/backup/service";
import { config } from "@/lib/config/env";
import { t } from "@/lib/i18n/translations";
import { listServerProfiles } from "@/lib/server/service";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";
import { CreateBackupForm } from "./create-backup-form";
import { ScheduleBackupForm } from "./schedule-backup-form";
import { RestoreBackupButton } from "./restore-backup-button";
import { RetentionButton } from "./retention-button";
import { RetryBackupRecordButton } from "./retry-backup-record-button";
import { VoidBackupRecordButton } from "./void-backup-record-button";
import { OffsiteDryRunButton } from "./offsite-dry-run-button";
import { loadOffsiteConfig } from "@/lib/storage/offsite/service";
import { formatZhDateTime } from "@/lib/datetime/format";

export const dynamic = "force-dynamic";

const projectRoot = config.app.appDir || process.cwd();

export default async function BackupsPage() {
	const session = await requireSession("/backups");
	if (!sessionHasPermission(session, "backup:read")) return <PageShell><EmptyState text={t("backupsPage.noPermission")} /></PageShell>;
	const canCreate = sessionHasPermission(session, "backup:create");
	const canRestore = sessionHasPermission(session, "backup:restore");
	const [backups, servers, offsite] = await Promise.all([
		listBackupRecords(),
		listServerProfiles(),
		loadOffsiteConfig().catch(() => null),
	]);
	const summary = summarizeBackupPolicy(backups);
	const serverOptions = servers.map((server) => ({ id: server.id, name: server.name, enabled: server.enabled }));
	const scheduledCommandByType = {
		DATABASE: buildScheduledBackupCommand({ projectRoot, type: "DATABASE" }),
		FILES: buildScheduledBackupCommand({ projectRoot, type: "FILES" }),
		FULL: buildScheduledBackupCommand({ projectRoot, type: "FULL" }),
	};
	return (
		<PageShell>
			<PageHeader eyebrow={t("backupsPage.eyebrow")} title={t("backupsPage.title")} description={t("backupsPage.description")} />

			<section className="mb-6 grid gap-3 md:grid-cols-4">
				<div data-card className="p-4">
					<p className="text-xs text-slate-500">{t("backupsPage.summary.completed")}</p>
					<p className="mt-1 text-2xl font-semibold text-white">{summary.completedRecords}</p>
					<p className="mt-1 text-xs text-slate-500">{t("backupsPage.summary.totalRecords").replace("{count}", String(summary.totalRecords))}</p>
				</div>
				<div data-card className="p-4">
					<p className="text-xs text-slate-500">{t("backupsPage.summary.usedSpace")}</p>
					<p className="mt-1 text-2xl font-semibold text-white">{formatBackupSize(summary.totalCompletedSizeBytes)}</p>
					<p className="mt-1 text-xs text-slate-500">{summary.largestCompleted ? t("backupsPage.summary.largestRecord").replace("{type}", summary.largestCompleted.type).replace("{size}", formatBackupSize(summary.largestCompleted.sizeBytes)) : t("backupsPage.summary.largestNone")}</p>
				</div>
				<div data-card className="p-4">
					<p className="text-xs text-slate-500">{t("backupsPage.summary.retentionNote")}</p>
					<p className="mt-1 text-2xl font-semibold text-white">{summary.recordsOlderThan30Days}</p>
					<p className="mt-1 text-xs text-slate-500">{t("backupsPage.summary.retentionHint")}</p>
				</div>
				<div data-card className="p-4">
					<p className="text-xs text-slate-500">{t("backupsPage.summary.exceptions")}</p>
					<p className="mt-1 text-2xl font-semibold text-white">{summary.failedRecords} / {summary.runningRecords}</p>
					<p className="mt-1 text-xs text-slate-500">{t("backupsPage.summary.exceptionsHint")}</p>
				</div>
			</section>

			<section data-card className="mb-6 ">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 className="text-sm font-semibold text-white">{t("backupsPage.overview.title")}</h2>
						<p className="mt-1 text-xs text-slate-500">{t("backupsPage.overview.description")}</p>
					</div>
					<p className="text-xs text-slate-500">{t("backupsPage.overview.latestCompleted").replace("{date}", formatZhDateTime(summary.latestCompletedAt, t("backupsPage.overview.latestNone")))}</p>
				</div>
				<div className="mt-4 grid gap-3 md:grid-cols-3">
					{(["DATABASE", "FILES", "FULL"] as const).map((type) => (
						<div key={type} className="rounded-lg border border-white/[0.06] bg-black/10 p-3/50">
							<p className="text-xs font-semibold text-cyan-200">{type}</p>
							<p className="mt-1 text-sm text-white">{t("backupsPage.overview.typeSummary").replace("{count}", String(summary.byType[type].count)).replace("{size}", formatBackupSize(summary.byType[type].sizeBytes))}</p>
						</div>
					))}
				</div>
			</section>

			<section data-card className="mb-6 ">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 className="text-sm font-semibold text-white">{t("backupsPage.failures.title")}</h2>
						<p className="mt-1 text-xs text-slate-500">{t("backupsPage.failures.description")}</p>
					</div>
					<p className="text-xs text-slate-500">{t("backupsPage.failures.count").replace("{count}", String(summary.failedRecords))}</p>
				</div>
				{summary.failureSummary.length === 0 ? (
					<p data-tone="emerald" className="mt-4 rounded-lg border border-emerald-400/20 px-3 py-2 text-xs text-emerald-200">{t("backupsPage.failures.empty")}</p>
				) : (
					<div className="mt-4 grid gap-3 md:grid-cols-2">
						{summary.failureSummary.map((item) => (
							<div key={item.category} data-tone="rose" className="rounded-lg border border-rose-400/20 p-3 light:bg-rose-50">
								<div className="flex items-center justify-between gap-3">
									<p className="text-xs font-semibold text-rose-200">{item.label}</p>
									<span className="rounded-full bg-rose-400/15 px-2 py-0.5 text-xs text-rose-100">{t("backupsPage.failures.itemCount").replace("{count}", String(item.count))}</span>
								</div>
								{item.latestRecordPath && <p className="mt-2 text-xs text-slate-500">{t("backupsPage.failures.latestRecord").replace("{path}", item.latestRecordPath)}</p>}
								<p className="mt-2 rounded-lg border border-white/[0.06] bg-black/10 px-2 py-1.5 text-xs text-slate-300/60">{t("backupsPage.failures.remediation").replace("{remediation}", item.remediation)}</p>
								{item.latestMessage && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.latestMessage}</p>}
							</div>
						))}
					</div>
				)}
			</section>

			{canCreate && (
				<section data-card className="mb-6 ">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div>
							<h2 className="text-sm font-semibold text-white">{t("backupsPage.retention.title")}</h2>
							<p className="mt-1 text-xs text-slate-500">{t("backupsPage.retention.description")}</p>
						</div>
					</div>
					<div className="mt-4">
						<RetentionButton olderThan30Days={summary.recordsOlderThan30Days} totalRecords={summary.totalRecords} />
					</div>
				</section>
			)}

			{canCreate && (
				<section data-card className="mb-6 ">
					<h2 className="text-sm font-semibold text-white">{t("backupsPage.create.title")}</h2>
					<p className="mt-1 text-xs text-slate-500">{t("backupsPage.create.description")}</p>
					<CreateBackupForm />
				</section>
			)}

			{canCreate && (
				<section data-card className="mb-6 ">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div>
							<h2 className="text-sm font-semibold text-white">{t("backupsPage.offsite.title")}</h2>
							<p className="mt-1 text-xs text-slate-500">{t("backupsPage.offsite.description")}</p>
						</div>
						<a
							href="/settings#offsite"
							className="rounded-lg border border-white/[0.08] px-2 py-1 text-xs text-slate-400 transition hover:border-white/[0.16] hover:text-slate-200"
						>
							{t("backupsPage.offsite.openSettings")}
						</a>
					</div>
					{offsite ? (
						<div className="mt-4 grid gap-3 text-xs text-slate-300 md:grid-cols-2">
							<p>
								<span
									data-tone={offsite.enabled ? "emerald" : "neutral"}
									className="mr-2 rounded-full border px-2 py-0.5 text-xs"
								>
									{offsite.enabled ? t("backupsPage.offsite.status.enabled") : t("backupsPage.offsite.status.disabled")}
								</span>
								{t("backupsPage.offsite.provider").replace("{provider}", offsite.provider)}
							</p>
							{offsite.bucket && <p>{t("backupsPage.offsite.bucket").replace("{bucket}", offsite.bucket)}</p>}
							{offsite.region && <p>{t("backupsPage.offsite.region").replace("{region}", offsite.region)}</p>}
							<p>{t("backupsPage.offsite.window").replace("{hour}", String(offsite.dailyWindowHour))}</p>
							<p>{t("backupsPage.offsite.retention").replace("{days}", String(offsite.retentionDays))}</p>
						</div>
					) : (
						<p className="mt-4 text-xs text-slate-500">{t("backupsPage.offsite.dryRunNever")}</p>
					)}
					<div className="mt-4">
						<OffsiteDryRunButton />
					</div>
				</section>
			)}

			{canCreate && (
				<section data-card className="mb-6 ">
					<h2 className="text-sm font-semibold text-white">{t("backupsPage.schedule.title")}</h2>
					<p className="mt-1 text-xs text-slate-500">{t("backupsPage.schedule.description")}</p>
					<ScheduleBackupForm servers={serverOptions} commandByType={scheduledCommandByType} />
				</section>
			)}

			<section data-card className="">
				<div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
					<h2 className="text-sm font-semibold text-white">{t("backupsPage.records.title")}</h2>
					<span className="text-xs text-slate-500">{t("backupsPage.records.count").replace("{count}", String(backups.length))}</span>
				</div>
				<div className="divide-y divide-white/[0.06]">
					{backups.length === 0 ? <EmptyState text={t("backupsPage.records.empty")} /> : backups.map((b) => (
						<div key={b.id} className="px-5 py-4">
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="text-sm font-medium text-white">{t("backupsPage.records.typeStatus").replace("{type}", b.type).replace("{status}", b.status)}</h3>
									<p className="mt-1 text-xs text-slate-500">{t("backupsPage.records.pathTime").replace("{path}", b.filePath).replace("{time}", formatZhDateTime(b.createdAt))}</p>
								</div>
								<span className="rounded-lg border border-white/[0.08] px-2 py-1 text-xs text-slate-400">{b.creator?.displayName || b.creator?.username || t("backupsPage.records.creatorSystem")}</span>
							</div>
							<div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
								<span>{t("backupsPage.records.size").replace("{size}", formatBackupSize(b.fileSize))}</span>
								<span>{b.completedAt ? t("backupsPage.records.completedAt").replace("{time}", formatZhDateTime(b.completedAt)) : t("backupsPage.records.notCompleted")}</span>
								{b.errorMessage && <span className="text-rose-300">{t("backupsPage.records.error").replace("{message}", b.errorMessage)}</span>}
							</div>
							{b.note && <p className="mt-2 text-xs text-slate-400">{b.note}</p>}
							{canRestore && (
								<div className="mt-3 grid gap-2">
									<code className="block overflow-auto rounded-lg border border-white/[0.06] bg-slate-950/70 p-3 font-mono text-xs text-slate-300">{buildPortableBackupCommand({ projectRoot, outputPath: b.filePath, type: isBackupType(b.type) ? b.type : undefined })}</code>
									<code className="block overflow-auto rounded-lg border border-white/[0.06] bg-slate-950/70 p-3 font-mono text-xs text-slate-300">{buildBackupRestoreCommand({ projectRoot, backupPath: b.filePath, type: isBackupType(b.type) ? b.type : undefined })}</code>
									<RestoreBackupButton backupId={b.id} backupType={b.type} disabled={b.status !== "COMPLETED"} />
									{b.status !== "COMPLETED" && <p className="text-xs text-slate-500">{t("backupsPage.records.restoreHint")}</p>}
								</div>
							)}
							{canCreate && b.status !== "COMPLETED" && (
								<div className="mt-3 flex flex-wrap items-start gap-3">
									{b.status === "FAILED" && <RetryBackupRecordButton backupId={b.id} status={b.status} />}
									<VoidBackupRecordButton backupId={b.id} status={b.status} />
									<p className="mt-1 text-xs text-slate-500">{t("backupsPage.records.voidHint")}</p>
								</div>
							)}
						</div>
					))}
				</div>
			</section>
		</PageShell>
	);
}
