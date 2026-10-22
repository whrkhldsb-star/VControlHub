import { getServerLocale } from "@/lib/i18n/translations";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { listShareLinkPage, SHARE_LINK_STATUS_FILTERS, type ShareLinkStatusFilter } from "@/lib/share-link/service";
import { listStorageNodes } from "@/lib/storage/service";
import { PageShell, EmptyState, PageHeader, ListPanel, ListRow } from "@/components/page-shell";
import { t as translate, type TFn } from "@/lib/i18n/translations";
import { formatDateTime } from "@/lib/datetime/format";
import { StatusBadge } from "@/components/status-badge";
import { CreateShareForm } from "./create-share-form";
import { ShareFilePicker } from "./share-file-picker";
import { ShareRowActions } from "./share-row-actions";
import { ShareAccessLogsButton } from "./share-access-logs";
import { ShareAccessReport } from "./share-access-report";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";
import { LinkPagination } from "@/components/link-pagination";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

export const dynamic = "force-dynamic";

type SharesSearchParams = { page?: string; status?: string; q?: string };

function sharesHref(filters: { status?: string; q?: string }, page: number) {
	const params = new URLSearchParams();
	if (filters.q) params.set("q", filters.q);
	if (filters.status) params.set("status", filters.status);
	if (page > 1) params.set("page", String(page));
	const query = params.toString();
	return query ? `/shares?${query}` : "/shares";
}

export default async function SharesPage({ searchParams }: { searchParams?: Promise<SharesSearchParams> }) {
	const locale = await getServerLocale();
	const t: TFn = (key, vars) => translate(key, locale, vars);
	const session = await requirePagePermission("share:read", { redirectTo: "/shares" });
	const params = (await searchParams) ?? {};
	const status = SHARE_LINK_STATUS_FILTERS.includes(params.status as ShareLinkStatusFilter) ? (params.status as ShareLinkStatusFilter) : undefined;
	const q = params.q?.trim().slice(0, 200) || undefined;
	const requestedPage = /^\d+$/.test(params.page ?? "") ? Number(params.page) : 1;
	const [{ shares, total, page, pageSize }, nodes] = await Promise.all([
		listShareLinkPage(session, { status, q, page: Number.isSafeInteger(requestedPage) ? requestedPage : 1 }),
		sessionHasPermission(session, "storage:read") ? listStorageNodes(session) : Promise.resolve([]),
	]);
	const canCreate = sessionHasPermission(session, "share:create") && sessionHasPermission(session, "storage:read");
	const canManage = sessionHasPermission(session, "share:manage");

	return (
		<PageShell>
			<PageHeader
				eyebrow={t("sharesPage.eyebrow")}
				title={t("shares.title")}
				description={t("shares.desc")}
			/>
			{/* Manage what is already shared first; creating and auditing follow. */}
			<ListPanel
				className="mb-5"
				title={t("shares.records")}
				count={total}
			>
				{/* Every share stays reachable: filters run in the database, then pages. */}
				<form method="get" action="/shares" className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
					<input
						type="search"
						name="q"
						defaultValue={q ?? ""}
						maxLength={200}
						placeholder={t("shares.filter.search")}
						aria-label={t("shares.filter.search")}
						className={cn(UI_INPUT, "h-9 min-w-0 flex-1 sm:max-w-xs")}
					/>
					<select name="status" defaultValue={status ?? ""} aria-label={t("shares.filter.status")} className={cn(UI_INPUT, "h-9 w-auto")}>
						<option value="">{t("shares.filter.statusAll")}</option>
						<option value="active">{t("shares.status.active")}</option>
						<option value="expired">{t("shares.status.expired")}</option>
						<option value="revoked">{t("shares.status.revoked")}</option>
					</select>
					<button type="submit" className={cn(UI_INPUT, "h-9 w-auto cursor-pointer px-3 font-medium")}>
						{t("shares.filter.apply")}
					</button>
				</form>
				{/* Under the filters, not in place of them: a search with no
				    result took the search box away with the list. */}
				{shares.length === 0 ? <EmptyState text={t("shares.empty")} /> : null}
				{shares.map((s) => (
					<ListRow key={s.id}>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0">
								<h3 className="ui-title-group truncate">
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
										<StatusBadge size="sm" tone={level === "preview" ? "warning" : "accent"}>
											{level === "preview"
												? t("sharesPage.permissionLevel.preview")
												: t("sharesPage.permissionLevel.download")}
										</StatusBadge>
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
				<LinkPagination
					page={page}
					pageSize={pageSize}
					total={total}
					hrefFor={(target) => sharesHref({ status, q }, target)}
					labels={{
						label: t("common.pagination.label"),
						range: t("common.pagination.range", { start: total ? (page - 1) * pageSize + 1 : 0, end: Math.min(page * pageSize, total), total }),
						previous: t("common.pagination.previous"),
						next: t("common.pagination.next"),
					}}
				/>
			</ListPanel>
			{canCreate ? (
				<div className="mb-5 space-y-4">
					<ShareFilePicker nodes={nodes.map((n) => ({ id: n.id, name: n.name, driver: n.driver, isDefault: n.isDefault, healthStatus: n.healthStatus }))} />
					<CreateShareForm nodes={nodes.map((n) => ({ id: n.id, name: `${n.name} · ${getStorageDriverLabel(t, n.driver)}` }))} />
				</div>
			) : null}
			{canManage ? <ShareAccessReport /> : null}
		</PageShell>
	);
}
