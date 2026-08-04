import { getServerLocale } from "@/lib/i18n/translations";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listShareLinks } from "@/lib/share-link/service";
import { listStorageNodes } from "@/lib/storage/service";
import { PageShell, EmptyState, PageHeader, ListPanel, ListRow } from "@/components/page-shell";
import { t } from "@/lib/i18n/translations";
import { formatDateTime } from "@/lib/datetime/format";
import { StatusBadge } from "@/components/status-badge";
import { CreateShareForm } from "./create-share-form";
import { ShareFilePicker } from "./share-file-picker";
import { ShareRowActions } from "./share-row-actions";
import { ShareAccessLogsButton } from "./share-access-logs";
import { ShareAccessReport } from "./share-access-report";

export const dynamic = "force-dynamic";

export default async function SharesPage() {
	const locale = await getServerLocale();
	const session = await requireSession("/shares");
	if (!sessionHasPermission(session, "share:read")) {
		return (
			<PageShell>
				<EmptyState text={t("shares.noPermission")} variant="boxed" />
			</PageShell>
		);
	}
	const [shares, nodes] = await Promise.all([listShareLinks(undefined, session), listStorageNodes(session)]);
	const canCreate = sessionHasPermission(session, "share:create");
	const canManage = sessionHasPermission(session, "share:manage");

	return (
		<PageShell>
			<PageHeader
				eyebrow={t("sharesPage.eyebrow", locale)}
				title={t("shares.title")}
				description={t("shares.desc")}
			/>
			{canManage ? <div className="mb-5"><ShareAccessReport /></div> : null}

			{canCreate ? (
				<div className="mb-5 space-y-4">
					<ShareFilePicker nodes={nodes.map((n) => ({ id: n.id, name: n.name, driver: n.driver }))} />
					<CreateShareForm nodes={nodes.map((n) => ({ id: n.id, name: `${n.name} · ${n.driver}` }))} />
				</div>
			) : null}

			<ListPanel
				title={t("shares.records")}
				count={shares.length}
				empty={
					shares.length === 0 ? <EmptyState text={t("shares.empty")} /> : undefined
				}
			>
				{shares.map((s) => (
					<ListRow key={s.id}>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0">
								<h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
									{s.name || s.path}
								</h3>
								<p className="mt-1 text-xs text-[var(--text-muted)]">
									{s.storageNode.name} · {s.path} · {s.permissionLevel === "preview"
										? t("shares.downloadDisabled")
										: s.maxDownloads == null
											? t("shares.downloadUsageUnlimited", { count: s.accessCount })
											: t("shares.downloadUsageLimited", { count: s.accessCount, max: s.maxDownloads })}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-2 sm:gap-3">
								<StatusBadge
									size="md"
									tone={s.revokedAt ? "neutral" : s.expiresAt && s.expiresAt < new Date() ? "warning" : "success"}
								>
									{s.revokedAt
										? t("shares.status.revoked")
										: s.expiresAt && s.expiresAt < new Date()
											? t("shares.status.expired")
											: t("shares.status.active")}
								</StatusBadge>
								{(() => {
									const level = (s as { permissionLevel?: "preview" | "download" }).permissionLevel ?? "download";
									return (
										<span
											className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
												level === "preview"
													? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]"
													: "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
											}`}
										>
											{level === "preview"
												? t("sharesPage.permissionLevel.preview")
												: t("sharesPage.permissionLevel.download")}
										</span>
									);
								})()}
								<ShareAccessLogsButton shareId={s.id} />
								{canManage ? <ShareRowActions id={s.id} revoked={Boolean(s.revokedAt)} /> : null}
							</div>
						</div>
						<p className="mt-2 text-xs text-[var(--text-muted)]">
							{t("shares.createdAt")}: {formatDateTime(s.createdAt, locale)} ·{" "}
							{t("shares.expiresAt")}:{" "}
							{s.expiresAt ? formatDateTime(s.expiresAt, locale) : t("shares.neverExpires")}
						</p>
					</ListRow>
				))}
			</ListPanel>
		</PageShell>
	);
}
