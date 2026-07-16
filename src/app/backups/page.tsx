import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { buildBackupRestoreCommand, buildPortableBackupCommand, formatBackupSize, isBackupType, listBackupRecords, summarizeBackupPolicy } from "@/lib/backup/service";
import { config } from "@/lib/config/env";
import { t } from "@/lib/i18n/translations";
import { PageShell, EmptyState, PageHeader, StatCard, StatGrid, SurfacePanel, ListPanel, ListRow } from "@/components/page-shell";
import { CreateBackupForm } from "./create-backup-form";
import { ScheduleBackupForm } from "./schedule-backup-form";
import { RestoreBackupButton } from "./restore-backup-button";
import { RetentionButton } from "./retention-button";
import { RetryBackupRecordButton } from "./retry-backup-record-button";
import { VoidBackupRecordButton } from "./void-backup-record-button";
import { OffsiteDryRunButton } from "./offsite-dry-run-button";
import { BackupDrillButton } from "./backup-drill-button";
import { MigrationWizardPanel } from "./migration-wizard-panel";
import { loadOffsiteConfig } from "@/lib/storage/offsite/service";
import { formatZhDateTime } from "@/lib/datetime/format";

export const dynamic = "force-dynamic";

const projectRoot = config.app.appDir || process.cwd();

export default async function BackupsPage() {
	const session = await requireSession("/backups");
	if (!sessionHasPermission(session, "backup:read")) return <PageShell><EmptyState text={t("backupsPage.noPermission")} variant="boxed" /></PageShell>;
	const canCreate = sessionHasPermission(session, "backup:create");
	const canRestore = sessionHasPermission(session, "backup:restore");
	const [backups, offsite] = await Promise.all([
		listBackupRecords(session),
		loadOffsiteConfig().catch(() => null),
	]);
	const summary = summarizeBackupPolicy(backups);
	return (
		<PageShell>
			<PageHeader eyebrow={t("backupsPage.eyebrow")} title={t("backupsPage.title")} description={t("backupsPage.description")} />

			<StatGrid cols={4}>
				<StatCard label={t("backupsPage.summary.completed")} value={String(summary.completedRecords)} detail={t("backupsPage.summary.totalRecords").replace("{count}", String(summary.totalRecords))} accent={summary.completedRecords > 0} accentColor="emerald" />
				<StatCard label={t("backupsPage.summary.usedSpace")} value={formatBackupSize(summary.totalCompletedSizeBytes)} detail={summary.largestCompleted ? t("backupsPage.summary.largestRecord").replace("{type}", summary.largestCompleted.type).replace("{size}", formatBackupSize(summary.largestCompleted.sizeBytes)) : t("backupsPage.summary.largestNone")} />
				<StatCard label={t("backupsPage.summary.retentionNote")} value={String(summary.recordsOlderThan30Days)} detail={t("backupsPage.summary.retentionHint")} accent={summary.recordsOlderThan30Days > 0} accentColor="amber" />
				<StatCard label={t("backupsPage.summary.exceptions")} value={`${summary.failedRecords} / ${summary.runningRecords}`} detail={t("backupsPage.summary.exceptionsHint")} accent={summary.failedRecords > 0} accentColor="rose" />
			</StatGrid>

			<div className="mb-5">
				<SurfacePanel
					title={t("backupsPage.overview.title")}
					description={t("backupsPage.overview.description")}
					actions={<span className="text-xs text-[var(--text-muted)]">{t("backupsPage.overview.latestCompleted").replace("{date}", formatZhDateTime(summary.latestCompletedAt, t("backupsPage.overview.latestNone")))}</span>}
				>
					<div className="grid gap-3 md:grid-cols-3">
						{(["DATABASE", "FILES", "FULL"] as const).map((type) => (
							<div key={type} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3">
								<p className="text-xs font-semibold text-[var(--text-secondary)]">{type}</p>
								<p className="mt-1 text-sm text-[var(--text-primary)]">{t("backupsPage.overview.typeSummary").replace("{count}", String(summary.byType[type].count)).replace("{size}", formatBackupSize(summary.byType[type].sizeBytes))}</p>
							</div>
						))}
					</div>
				</SurfacePanel>
			</div>

			<div className="mb-5">
			<SurfacePanel
				title={t("backupsPage.failures.title")}
				description={t("backupsPage.failures.description")}
				actions={<span className="text-xs text-[var(--text-muted)]">{t("backupsPage.failures.count").replace("{count}", String(summary.failedRecords))}</span>}
			>
				{summary.failureSummary.length === 0 ? (
					<p data-tone="emerald" className="mt-4 rounded-lg border border-[var(--success-border)] px-3 py-2 text-xs text-[var(--success)]">{t("backupsPage.failures.empty")}</p>
				) : (
					<div className="mt-4 grid gap-3 md:grid-cols-2">
						{summary.failureSummary.map((item) => (
							<div key={item.category} className="rounded-xl border border-[var(--danger-border)] bg-[color-mix(in_srgb,var(--danger-bg)_40%,var(--surface))] p-3">
								<div className="flex items-center justify-between gap-3">
									<p className="text-xs font-semibold text-[var(--danger)]">{item.label}</p>
									<span className="rounded-full bg-[var(--danger-bg)] px-2 py-0.5 text-xs text-[var(--danger)]">{t("backupsPage.failures.itemCount").replace("{count}", String(item.count))}</span>
								</div>
								{item.latestRecordPath && <p className="mt-2 text-xs text-[var(--text-muted)]">{t("backupsPage.failures.latestRecord").replace("{path}", item.latestRecordPath)}</p>}
								<p className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text-secondary)]">{t("backupsPage.failures.remediation").replace("{remediation}", item.remediation)}</p>
								{item.latestMessage && <p className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{item.latestMessage}</p>}
							</div>
						))}
					</div>
				)}
			</SurfacePanel>
			</div>

			{canCreate && (
				<div className="mb-5">
					<SurfacePanel title={t("backupsPage.retention.title")} description={t("backupsPage.retention.description")}>
						<RetentionButton olderThan30Days={summary.recordsOlderThan30Days} totalRecords={summary.totalRecords} />
					</SurfacePanel>
				</div>
			)}

			
			{canCreate && (
				<div className="mb-5">
					<SurfacePanel title={t("backupsPage.migration.title")} description={t("backupsPage.migration.description")}>
						<MigrationWizardPanel
							canCreate={canCreate}
							completedBackups={backups
								.filter((b) => b.status === "COMPLETED")
								.map((b) => ({
									id: b.id,
									type: b.type,
									filePath: b.filePath,
									label: `${b.type} · ${b.filePath} · ${b.id.slice(0, 8)}`,
								}))}
						/>
					</SurfacePanel>
				</div>
			)}
{canCreate && (
				<div className="mb-5">
					<SurfacePanel title={t("backupsPage.create.title")} description={t("backupsPage.create.description")}>
						<CreateBackupForm />
					</SurfacePanel>
				</div>
			)}

			{canCreate && (
				<div className="mb-5">
					<SurfacePanel
						title={t("backupsPage.offsite.title")}
						description={t("backupsPage.offsite.description")}
						actions={
							<a
								href="/settings#offsite"
								className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
							>
								{t("backupsPage.offsite.openSettings")}
							</a>
						}
					>
					{offsite ? (
						<div className="mt-4 grid gap-3 text-xs text-[var(--text-secondary)] md:grid-cols-2">
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
						<p className="mt-4 text-xs text-[var(--text-muted)]">{t("backupsPage.offsite.dryRunNever")}</p>
					)}
					<div className="mt-2">
						<OffsiteDryRunButton />
					</div>
					</SurfacePanel>
				</div>
			)}

			{canCreate && (
				<div className="mb-5">
					<SurfacePanel title={t("backupsPage.schedule.title")} description={t("backupsPage.schedule.description")}>
						<ScheduleBackupForm />
					</SurfacePanel>
				</div>
			)}

			<ListPanel
				title={t("backupsPage.records.title")}
				count={t("backupsPage.records.count").replace("{count}", String(backups.length))}
				empty={backups.length === 0 ? <EmptyState text={t("backupsPage.records.empty")} /> : undefined}
			>
					{backups.map((b) => (
						<ListRow key={b.id}>
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="text-sm font-medium text-[var(--text-primary)]">{t("backupsPage.records.typeStatus").replace("{type}", b.type).replace("{status}", b.status)}</h3>
									<p className="mt-1 text-xs text-[var(--text-muted)]">{t("backupsPage.records.pathTime").replace("{path}", b.filePath).replace("{time}", formatZhDateTime(b.createdAt))}</p>
								</div>
								<span className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)]">{b.creator?.displayName || b.creator?.username || t("backupsPage.records.creatorSystem")}</span>
							</div>
							<div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
								<span>{t("backupsPage.records.size").replace("{size}", formatBackupSize(b.fileSize))}</span>
								<span>{b.completedAt ? t("backupsPage.records.completedAt").replace("{time}", formatZhDateTime(b.completedAt)) : t("backupsPage.records.notCompleted")}</span>
								{b.errorMessage && <span className="text-[var(--danger)]">{t("backupsPage.records.error").replace("{message}", b.errorMessage)}</span>}
							</div>
							{b.note && <p className="mt-2 text-xs text-[var(--text-muted)]">{b.note}</p>}
							{canRestore && (
								<div className="mt-3 grid gap-2">
									<code className="block overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 font-mono text-xs text-[var(--text-secondary)]">{buildPortableBackupCommand({ projectRoot, outputPath: b.filePath, type: isBackupType(b.type) ? b.type : undefined })}</code>
									<code className="block overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 font-mono text-xs text-[var(--text-secondary)]">{buildBackupRestoreCommand({ projectRoot, backupPath: b.filePath, type: isBackupType(b.type) ? b.type : undefined })}</code>
									<RestoreBackupButton backupId={b.id} backupType={b.type} disabled={b.status !== "COMPLETED"} />
									<BackupDrillButton backupId={b.id} disabled={b.status !== "COMPLETED"} />
									{b.status !== "COMPLETED" && <p className="text-xs text-[var(--text-muted)]">{t("backupsPage.records.restoreHint")}</p>}
								</div>
							)}
							{canCreate && b.status !== "COMPLETED" && (
								<div className="mt-3 flex flex-wrap items-start gap-3">
									{b.status === "FAILED" && <RetryBackupRecordButton backupId={b.id} status={b.status} />}
									<VoidBackupRecordButton backupId={b.id} status={b.status} />
									<p className="mt-1 text-xs text-[var(--text-muted)]">{t("backupsPage.records.voidHint")}</p>
								</div>
							)}
						</ListRow>
					))}
			</ListPanel>
		</PageShell>
	);
}
