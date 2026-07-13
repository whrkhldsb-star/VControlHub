import { getServerLocale } from "@/lib/i18n/translations";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listShareLinks } from "@/lib/share-link/service";
import { listStorageNodes } from "@/lib/storage/service";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";
import { t } from "@/lib/i18n/translations";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { CreateShareForm } from "./create-share-form";
import { ShareFilePicker } from "./share-file-picker";
import { ShareRowActions } from "./share-row-actions";

export const revalidate = 60;

export default async function SharesPage() {
	const locale = await getServerLocale();
	const session = await requireSession("/shares");
	if (!sessionHasPermission(session, "share:read")) return <PageShell><EmptyState text={t("shares.noPermission")} /></PageShell>;
	const [shares, nodes] = await Promise.all([listShareLinks(), listStorageNodes()]);
	const canCreate = sessionHasPermission(session, "share:create");
	const canManage = sessionHasPermission(session, "share:manage");

	return (
		<PageShell>
			<PageHeader eyebrow={t("sharesPage.eyebrow", locale)} title={t("shares.title")} description={t("shares.desc")} />

			{canCreate ? (
				<div className="mb-6 space-y-4">
					<ShareFilePicker nodes={nodes.map((n) => ({ id: n.id, name: n.name, driver: n.driver }))} />
					<CreateShareForm nodes={nodes.map((n) => ({ id: n.id, name: `${n.name} · ${n.driver}` }))} />
				</div>
			) : null}

			<div data-card className="overflow-hidden !p-0">
				<div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
					<div className="text-sm font-semibold text-[var(--text-primary)]">{t("shares.records")}</div>
					<span className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">{shares.length}</span>
				</div>
				<div className="divide-y divide-[var(--border-subtle)]">
					{shares.length === 0 ? <EmptyState text={t("shares.empty")} /> : shares.map((s) => (
						<div key={s.id} className="px-5 py-4 transition hover:bg-[var(--surface-hover)]">
							<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<div className="min-w-0">
									<h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{s.name || s.path}</h3>
									<p className="mt-1 text-xs text-[var(--text-muted)]">{s.storageNode.name} · {s.path} · {t("shares.accessCountPrefix")}{s.accessCount}{t("shares.accessCountSuffix")}</p>
								</div>
								<div className="flex items-center gap-3">
									<span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
										s.revokedAt ? "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]"
										: s.expiresAt && s.expiresAt < new Date() ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]"
										: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"
									}`}>
										{s.revokedAt ? t("shares.status.revoked") : s.expiresAt && s.expiresAt < new Date() ? t("shares.status.expired") : t("shares.status.active")}
									</span>
									{canManage ? <ShareRowActions id={s.id} revoked={Boolean(s.revokedAt)} /> : null}
								</div>
							</div>
							<p className="mt-2 text-xs text-[var(--text-muted)]">{t("shares.createdAt")}: {s.createdAt.toLocaleString(toDateLocale(locale))} · {t("shares.expiresAt")}: {s.expiresAt?.toLocaleString(toDateLocale(locale)) ?? t("shares.neverExpires")}</p>
						</div>
					))}
				</div>
			</div>
		</PageShell>
	);
}
