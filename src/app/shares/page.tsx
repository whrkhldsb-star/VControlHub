import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listShareLinks } from "@/lib/share-link/service";
import { listStorageNodes } from "@/lib/storage/service";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";
import { t } from "@/lib/i18n/translations";
import { CreateShareForm } from "./create-share-form";
import { ShareFilePicker } from "./share-file-picker";
import { ShareRowActions } from "./share-row-actions";

export const dynamic = "force-dynamic";

export default async function SharesPage() {
	const session = await requireSession("/shares");
	if (!sessionHasPermission(session, "share:read")) return <PageShell><EmptyState text={t("shares.noPermission")} /></PageShell>;
	const [shares, nodes] = await Promise.all([listShareLinks(), listStorageNodes()]);
	const canCreate = sessionHasPermission(session, "share:create");
	const canManage = sessionHasPermission(session, "share:manage");

	return (
		<PageShell>
			<PageHeader eyebrow="Sharing" title={t("shares.title")} description={t("shares.desc")} />

			{canCreate ? (
				<div className="mb-6 space-y-4">
					<ShareFilePicker nodes={nodes.map((n) => ({ id: n.id, name: n.name, driver: n.driver }))} />
					<CreateShareForm nodes={nodes.map((n) => ({ id: n.id, name: `${n.name} · ${n.driver}` }))} />
				</div>
			) : null}

			<div data-card className="">
				<div className="border-b border-white/[0.06] px-5 py-4 text-sm font-semibold text-white">{t("shares.records")}</div>
				<div className="divide-y divide-white/[0.06]">
					{shares.length === 0 ? <EmptyState text={t("shares.empty")} /> : shares.map((s) => (
						<div key={s.id} className="px-5 py-4">
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="text-sm font-medium text-white">{s.name || s.path}</h3>
									<p className="mt-1 text-xs text-slate-500">{s.storageNode.name} · {s.path} · {t("shares.accessCountPrefix")}{s.accessCount}{t("shares.accessCountSuffix")}</p>
								</div>
								<div className="flex items-center gap-3">
									<span className="rounded-lg border border-white/[0.08] px-2 py-1 text-xs text-slate-400">
										{s.revokedAt ? t("shares.status.revoked") : s.expiresAt && s.expiresAt < new Date() ? t("shares.status.expired") : t("shares.status.active")}
									</span>
									{canManage ? <ShareRowActions id={s.id} revoked={Boolean(s.revokedAt)} /> : null}
								</div>
							</div>
							<p className="mt-2 text-xs text-slate-500">{t("shares.createdAt")}：{s.createdAt.toLocaleString("zh-CN")} · {t("shares.expiresAt")}：{s.expiresAt?.toLocaleString("zh-CN") ?? t("shares.neverExpires")}</p>
						</div>
					))}
				</div>
			</div>
		</PageShell>
	);
}
