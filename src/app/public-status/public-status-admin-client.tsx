"use client";

/**
 * Status board management: site settings and per-server publication.
 * Every server starts private; publishing needs an explicit public name.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { ActionButton, ButtonLink } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { Dialog } from "@/components/ui/dialog";
import { CheckboxField, FormField, Notice, Switch } from "@/components/ui-primitives";
import { useToast } from "@/components/toast-provider";
import { api, ApiError } from "@/lib/http/api-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatAge } from "@/lib/public-status/format";
import type { AdminNodeFilter, AdminNodeRow } from "@/lib/public-status/nodes-admin";
import {
	ANNOUNCEMENT_MAX,
	DESCRIPTION_MAX,
	PUBLIC_ACCENTS,
	PUBLIC_METRIC_CATEGORIES,
	PUBLIC_REFRESH_SECONDS,
	TITLE_MAX,
	type PublicSiteConfig,
} from "@/lib/public-status/site-config";
import { UI_INPUT } from "@/lib/ui/classes";
import { ACCENT_VARS } from "../status/public-board-parts";

type T = (key: string, vars?: Record<string, string | number>) => string;

const PAGE_SIZE = 25;

/** The shared Switch only carries an aria-label; show the label as text too. */
function SwitchRow({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
	return (
		<div className="flex items-center gap-3 text-sm">
			<Switch checked={checked} onCheckedChange={onChange} label={label} />
			<span aria-hidden>{label}</span>
		</div>
	);
}

function errorText(error: unknown) {
	return error instanceof ApiError || error instanceof Error ? error.message : String(error);
}

/* ── Site settings ─────────────────────────────────────────────── */

function SiteSettings({ initial, t }: { initial: PublicSiteConfig; t: T }) {
	const { addToast } = useToast();
	const [site, setSite] = useState(initial);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const set = <K extends keyof PublicSiteConfig>(key: K, value: PublicSiteConfig[K]) => setSite((prev) => ({ ...prev, [key]: value }));

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const result = await api.put<{ site: PublicSiteConfig }>("/api/admin/public-status/site", {
				enabled: site.enabled,
				title: site.title,
				description: site.description,
				announcement: site.announcement,
				defaultView: site.defaultView,
				refreshSeconds: site.refreshSeconds,
				accent: site.accent,
				metrics: site.metrics,
				showPlatformStatus: site.showPlatformStatus,
			});
			setSite(result.site);
			addToast("success", t("publicStatusAdmin.site.saved"));
		} catch (err) {
			setError(errorText(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<section data-card className="flex flex-col gap-4 p-5" aria-labelledby="site-settings-title">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 id="site-settings-title" className="ui-title-section">{t("publicStatusAdmin.site.title")}</h2>
					<p className="mt-1 text-xs text-[var(--text-muted)]">{t("publicStatusAdmin.site.desc")}</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<ButtonLink href="/status?preview=1" variant="outline" size="sm">{t("publicStatusAdmin.previewAsGuest")}</ButtonLink>
					{initial.enabled ? <ButtonLink href="/status" variant="ghost" size="sm" external>{t("publicStatusAdmin.openPublic")}</ButtonLink> : null}
				</div>
			</div>
			<SwitchRow checked={site.enabled} onChange={(value) => set("enabled", value)} label={t("publicStatusAdmin.site.enabled")} />
			{site.enabled ? null : <p className="text-xs text-[var(--text-muted)]">{t("publicStatusAdmin.site.disabledHint")}</p>}
			<div className="grid gap-4 md:grid-cols-2">
				<FormField label={t("publicStatusAdmin.site.titleField")} htmlFor="ps-title" hint={t("publicStatusAdmin.site.titleHint")}>
					<input id="ps-title" className={UI_INPUT} maxLength={TITLE_MAX} value={site.title ?? ""} onChange={(e) => set("title", e.target.value || null)} />
				</FormField>
				<FormField label={t("publicStatusAdmin.site.defaultView")} htmlFor="ps-view">
					<select id="ps-view" className={UI_INPUT} value={site.defaultView} onChange={(e) => set("defaultView", e.target.value === "table" ? "table" : "cards")}>
						<option value="cards">{t("publicStatus.view.cards")}</option>
						<option value="table">{t("publicStatus.view.table")}</option>
					</select>
				</FormField>
				<FormField label={t("publicStatusAdmin.site.descriptionField")} htmlFor="ps-desc" hint={t("publicStatusAdmin.site.plainText")}>
					<textarea id="ps-desc" className={UI_INPUT} rows={3} maxLength={DESCRIPTION_MAX} value={site.description ?? ""} onChange={(e) => set("description", e.target.value || null)} />
				</FormField>
				<FormField label={t("publicStatusAdmin.site.announcement")} htmlFor="ps-ann" hint={t("publicStatusAdmin.site.plainText")}>
					<textarea id="ps-ann" className={UI_INPUT} rows={3} maxLength={ANNOUNCEMENT_MAX} value={site.announcement ?? ""} onChange={(e) => set("announcement", e.target.value || null)} />
				</FormField>
				<FormField label={t("publicStatusAdmin.site.refresh")} htmlFor="ps-refresh" hint={t("publicStatusAdmin.site.refreshHint")}>
					<select id="ps-refresh" className={UI_INPUT} value={site.refreshSeconds} onChange={(e) => set("refreshSeconds", Number(e.target.value) as PublicSiteConfig["refreshSeconds"])}>
						{PUBLIC_REFRESH_SECONDS.map((seconds) => (
							<option key={seconds} value={seconds}>{t("publicStatusAdmin.site.seconds", { seconds })}</option>
						))}
					</select>
				</FormField>
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-1 text-sm font-medium">{t("publicStatusAdmin.site.accent")}</legend>
					<div className="flex flex-wrap gap-2">
						{PUBLIC_ACCENTS.map((accent) => (
							<label key={accent} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-xs has-[:checked]:border-[var(--accent)]">
								<input type="radio" name="ps-accent" value={accent} checked={site.accent === accent} onChange={() => set("accent", accent)} />
								<span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: ACCENT_VARS[accent] }} />
								{t(`publicStatusAdmin.accent.${accent}`)}
							</label>
						))}
					</div>
				</fieldset>
			</div>
			<fieldset>
				<legend className="mb-2 text-sm font-medium">{t("publicStatusAdmin.site.metrics")}</legend>
				<p className="mb-2 text-xs text-[var(--text-muted)]">{t("publicStatusAdmin.site.metricsHint")}</p>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
					{PUBLIC_METRIC_CATEGORIES.map((category) => (
						<CheckboxField
							key={category}
							label={t(`publicStatusAdmin.metric.${category}`)}
							checked={site.metrics.includes(category)}
							onChange={(e) =>
								set("metrics", e.target.checked ? [...site.metrics, category] : site.metrics.filter((item) => item !== category))
							}
						/>
					))}
				</div>
			</fieldset>
			<SwitchRow checked={site.showPlatformStatus} onChange={(value) => set("showPlatformStatus", value)} label={t("publicStatusAdmin.site.showPlatform")} />
			<p className="text-xs text-[var(--text-muted)]">{t("publicStatusAdmin.site.themeHint")}</p>
			{error ? <Notice tone="danger">{error}</Notice> : null}
			<div>
				<ActionButton onClick={save} loading={saving}>{t("publicStatusAdmin.save")}</ActionButton>
			</div>
		</section>
	);
}

/* ── Node publication ──────────────────────────────────────────── */

type ListResponse = { total: number; rows: AdminNodeRow[]; page: number; pageSize: number };

type EditState = {
	row: AdminNodeRow;
	displayName: string;
	groupName: string;
	region: string;
	tags: string;
	sortOrder: string;
	note: string;
	maintenance: boolean;
	published: boolean;
};

function editStateFor(row: AdminNodeRow): EditState {
	const p = row.publication;
	return {
		row,
		// Deliberately empty for a new entry: never prefilled from the internal name.
		displayName: p?.displayName ?? "",
		groupName: p?.groupName ?? "",
		region: p?.region ?? "",
		tags: p?.tags.join(", ") ?? "",
		sortOrder: String(p?.sortOrder ?? 0),
		note: p?.note ?? "",
		maintenance: p?.maintenance ?? false,
		published: p?.published ?? false,
	};
}

function publicationBadge(row: AdminNodeRow, t: T) {
	const p = row.publication;
	if (!p || !p.published) return <StatusBadge tone="neutral">{t("publicStatusAdmin.state.private")}</StatusBadge>;
	if (p.hiddenReason) return <StatusBadge tone="warning">{t(`publicStatusAdmin.hidden.${p.hiddenReason}`)}</StatusBadge>;
	if (p.maintenance) return <StatusBadge tone="info">{t("publicStatusAdmin.state.maintenance")}</StatusBadge>;
	return <StatusBadge tone="success">{t("publicStatusAdmin.state.published")}</StatusBadge>;
}

function EditDialog({ state, onClose, onSaved, metrics, t }: { state: EditState; onClose: () => void; onSaved: () => void; metrics: string[]; t: T }) {
	const [form, setForm] = useState(state);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const tags = form.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			await api.put(`/api/admin/public-status/nodes/${encodeURIComponent(form.row.serverId)}`, {
				displayName: form.displayName,
				groupName: form.groupName || null,
				region: form.region || null,
				tags,
				sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
				note: form.note || null,
				maintenance: form.maintenance,
				published: form.published,
			});
			onSaved();
		} catch (err) {
			setError(errorText(err));
		} finally {
			setSaving(false);
		}
	};
	const field = (key: keyof EditState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
	const ownerChanged = form.row.publication?.hiddenReason === "owner_changed";
	return (
		<Dialog
			open
			onClose={onClose}
			busy={saving}
			size="xl"
			title={t("publicStatusAdmin.edit.title")}
			description={t("publicStatusAdmin.edit.internal", { name: form.row.serverName })}
			footer={
				<>
					<ActionButton variant="secondary" onClick={onClose}>{t("publicStatusAdmin.cancel")}</ActionButton>
					<ActionButton onClick={save} loading={saving} disabled={!form.displayName.trim()}>{t("publicStatusAdmin.save")}</ActionButton>
				</>
			}
		>
			<div className="grid gap-4 md:grid-cols-2">
				<div className="flex flex-col gap-3">
					<FormField label={t("publicStatusAdmin.edit.displayName")} htmlFor="pn-name" hint={t("publicStatusAdmin.edit.displayNameHint")}>
						<input id="pn-name" className={UI_INPUT} maxLength={60} required value={form.displayName} onChange={field("displayName")} />
					</FormField>
					<FormField label={t("publicStatusAdmin.edit.group")} htmlFor="pn-group">
						<input id="pn-group" className={UI_INPUT} maxLength={40} value={form.groupName} onChange={field("groupName")} />
					</FormField>
					<FormField label={t("publicStatusAdmin.edit.region")} htmlFor="pn-region" hint={t("publicStatusAdmin.edit.regionHint")}>
						<input id="pn-region" className={UI_INPUT} maxLength={40} value={form.region} onChange={field("region")} />
					</FormField>
					<FormField label={t("publicStatusAdmin.edit.tags")} htmlFor="pn-tags" hint={t("publicStatusAdmin.edit.tagsHint")}>
						<input id="pn-tags" className={UI_INPUT} value={form.tags} onChange={field("tags")} />
					</FormField>
					<FormField label={t("publicStatusAdmin.edit.sortOrder")} htmlFor="pn-sort" hint={t("publicStatusAdmin.edit.sortOrderHint")}>
						<input id="pn-sort" className={UI_INPUT} type="number" min={-100000} max={100000} value={form.sortOrder} onChange={field("sortOrder")} />
					</FormField>
					<FormField label={t("publicStatusAdmin.edit.note")} htmlFor="pn-note" hint={t("publicStatusAdmin.site.plainText")}>
						<textarea id="pn-note" className={UI_INPUT} rows={2} maxLength={280} value={form.note} onChange={field("note")} />
					</FormField>
					<SwitchRow checked={form.maintenance} onChange={(value) => setForm((prev) => ({ ...prev, maintenance: value }))} label={t("publicStatusAdmin.edit.maintenance")} />
					<SwitchRow checked={form.published} onChange={(value) => setForm((prev) => ({ ...prev, published: value }))} label={t("publicStatusAdmin.edit.published")} />
					{ownerChanged && form.published ? <Notice tone="warning">{t("publicStatusAdmin.edit.ownerChanged", { customer: form.row.customerName ?? "—" })}</Notice> : null}
				</div>
				<aside data-inset className="p-3 text-sm" aria-labelledby="pn-preview-title">
					<h3 id="pn-preview-title" className="ui-title-group">{t("publicStatusAdmin.preview.title")}</h3>
					<p className="mt-1 text-xs text-[var(--text-muted)]">{form.published ? t("publicStatusAdmin.preview.willShow") : t("publicStatusAdmin.preview.private")}</p>
					<dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
						<dt className="text-[var(--text-muted)]">{t("publicStatusAdmin.edit.displayName")}</dt>
						<dd className="break-words">{form.displayName.trim() || <span className="text-[var(--danger)]">{t("publicStatusAdmin.preview.nameMissing")}</span>}</dd>
						<dt className="text-[var(--text-muted)]">{t("publicStatusAdmin.edit.group")}</dt>
						<dd>{form.groupName.trim() || "—"}</dd>
						<dt className="text-[var(--text-muted)]">{t("publicStatusAdmin.edit.region")}</dt>
						<dd>{form.region.trim() || "—"}</dd>
						<dt className="text-[var(--text-muted)]">{t("publicStatusAdmin.edit.tags")}</dt>
						<dd>{tags.length ? tags.join(" · ") : "—"}</dd>
						<dt className="text-[var(--text-muted)]">{t("publicStatusAdmin.edit.note")}</dt>
						<dd className="whitespace-pre-line break-words">{form.note.trim() || "—"}</dd>
						<dt className="text-[var(--text-muted)]">{t("publicStatusAdmin.preview.metrics")}</dt>
						<dd>{metrics.length ? metrics.map((m) => t(`publicStatusAdmin.metric.${m}`)).join("、") : "—"}</dd>
					</dl>
					<p className="mt-3 text-xs text-[var(--text-muted)]">{t("publicStatusAdmin.preview.never")}</p>
				</aside>
			</div>
			{error ? <Notice tone="danger" className="mt-3">{error}</Notice> : null}
		</Dialog>
	);
}

function NodePublication({ metrics, t }: { metrics: string[]; t: T }) {
	const { locale } = useI18n();
	const { addToast } = useToast();
	const fieldId = useId();
	const [q, setQ] = useState("");
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<AdminNodeFilter>("all");
	const [page, setPage] = useState(1);
	const [data, setData] = useState<ListResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [editing, setEditing] = useState<EditState | null>(null);
	const [busy, setBusy] = useState(false);
	const [nowMs, setNowMs] = useState(() => Date.now());
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		const timer = setTimeout(() => {
			setQuery(q.trim());
			setPage(1);
		}, 300);
		return () => clearTimeout(timer);
	}, [q]);

	useEffect(() => {
		const controller = new AbortController();
		const params = new URLSearchParams({ q: query, filter, page: String(page), pageSize: String(PAGE_SIZE) });
		api
			.get<ListResponse>(`/api/admin/public-status/nodes?${params}`, { signal: controller.signal })
			.then((result) => {
				setData(result);
				setError(null);
				setNowMs(Date.now());
			})
			.catch((err) => {
				if (!controller.signal.aborted) setError(errorText(err));
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [query, filter, page, reloadKey]);

	const reload = useCallback(() => {
		setLoading(true);
		setReloadKey((key) => key + 1);
	}, []);
	const rows = useMemo(() => data?.rows ?? [], [data]);
	const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
	const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.serverId));
	const toggle = (id: string) => setSelected((prev) => {
		const next = new Set(prev);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		return next;
	});

	const batch = async (action: "publish" | "unpublish" | "maintenance_on" | "maintenance_off") => {
		setBusy(true);
		try {
			const result = await api.post<{ changed: number; skipped: string[] }>("/api/admin/public-status/nodes", { action, serverIds: [...selected] });
			addToast(result.skipped.length ? "warning" : "success", t("publicStatusAdmin.batch.result", { changed: result.changed, skipped: result.skipped.length }));
			setSelected(new Set());
			reload();
		} catch (err) {
			addToast("error", errorText(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section data-card className="flex flex-col gap-4 p-5" aria-labelledby="nodes-title">
			<div>
				<h2 id="nodes-title" className="ui-title-section">{t("publicStatusAdmin.nodes.title")}</h2>
				<p className="mt-1 text-xs text-[var(--text-muted)]">{t("publicStatusAdmin.nodes.desc")}</p>
			</div>
			<div className="flex flex-wrap items-end gap-2">
				<div className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-[var(--text-muted)]">
					<label htmlFor={`${fieldId}-q`}>{t("publicStatusAdmin.nodes.search")}</label>
					<input id={`${fieldId}-q`} type="search" className={UI_INPUT} value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
				</div>
				<div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
					<label htmlFor={`${fieldId}-filter`}>{t("publicStatusAdmin.nodes.filter")}</label>
					<select id={`${fieldId}-filter`} className={UI_INPUT} value={filter} onChange={(e) => { setFilter(e.target.value as AdminNodeFilter); setPage(1); }}>
						{(["all", "published", "unpublished", "attention"] as const).map((value) => (
							<option key={value} value={value}>{t(`publicStatusAdmin.filter.${value}`)}</option>
						))}
					</select>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("publicStatusAdmin.batch.label")}>
				<span className="text-xs text-[var(--text-muted)]">{t("publicStatusAdmin.batch.selected", { count: selected.size })}</span>
				<ActionButton size="sm" variant="outline" disabled={!selected.size || busy} onClick={() => batch("publish")}>{t("publicStatusAdmin.batch.publish")}</ActionButton>
				<ActionButton size="sm" variant="outline" disabled={!selected.size || busy} onClick={() => batch("unpublish")}>{t("publicStatusAdmin.batch.unpublish")}</ActionButton>
				<ActionButton size="sm" variant="ghost" disabled={!selected.size || busy} onClick={() => batch("maintenance_on")}>{t("publicStatusAdmin.batch.maintenanceOn")}</ActionButton>
				<ActionButton size="sm" variant="ghost" disabled={!selected.size || busy} onClick={() => batch("maintenance_off")}>{t("publicStatusAdmin.batch.maintenanceOff")}</ActionButton>
			</div>
			<p className="text-xs text-[var(--text-muted)]">{t("publicStatusAdmin.batch.hint")}</p>
			{error ? <Notice tone="danger" action={{ label: t("publicStatus.retry"), onClick: reload }}>{error}</Notice> : null}
			<div className="relative overflow-x-auto">
				<table className="w-full min-w-[720px] text-left text-sm">
					<caption className="sr-only">{t("publicStatusAdmin.nodes.title")}</caption>
					<thead className="text-xs text-[var(--text-muted)]">
						<tr>
							<th scope="col" className="w-8 px-2 py-2">
								<input
									type="checkbox"
									aria-label={t("publicStatusAdmin.nodes.selectAll")}
									checked={allSelected}
									onChange={() => setSelected((prev) => {
										const next = new Set(prev);
										for (const row of rows) {
											if (allSelected) next.delete(row.serverId);
											else next.add(row.serverId);
										}
										return next;
									})}
								/>
							</th>
							<th scope="col" className="px-2 py-2 font-medium">{t("publicStatusAdmin.nodes.server")}</th>
							<th scope="col" className="px-2 py-2 font-medium">{t("publicStatusAdmin.nodes.publicName")}</th>
							<th scope="col" className="px-2 py-2 font-medium">{t("publicStatusAdmin.nodes.state")}</th>
							<th scope="col" className="px-2 py-2 font-medium">{t("publicStatusAdmin.nodes.lastSample")}</th>
							<th scope="col" className="px-2 py-2 font-medium"><span className="sr-only">{t("publicStatusAdmin.nodes.actions")}</span></th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.serverId} className="border-t border-[var(--border-subtle)]" data-admin-node={row.serverId}>
								<td className="px-2 py-2">
									<input type="checkbox" aria-label={t("publicStatusAdmin.nodes.select", { name: row.serverName })} checked={selected.has(row.serverId)} onChange={() => toggle(row.serverId)} />
								</td>
								<td className="px-2 py-2">
									<span className="block font-medium">{row.serverName}</span>
									<span className="block text-xs text-[var(--text-muted)]">
										{[row.customerName ?? t("publicStatusAdmin.nodes.platformOwned"), row.managementMode === "AGENT" ? "Agent" : "SSH", row.enabled ? null : t("publicStatusAdmin.nodes.disabled")].filter(Boolean).join(" · ")}
									</span>
								</td>
								<td className="px-2 py-2">
									{row.publication ? (
										<>
											<span className="block">{row.publication.displayName}</span>
											<span className="block text-xs text-[var(--text-muted)]">{[row.publication.region, row.publication.groupName].filter(Boolean).join(" · ")}</span>
										</>
									) : (
										<span className="text-xs text-[var(--text-muted)]">{t("publicStatusAdmin.nodes.notConfigured")}</span>
									)}
								</td>
								<td className="px-2 py-2">{publicationBadge(row, t)}</td>
								<td className="px-2 py-2 text-xs text-[var(--text-muted)]">{row.lastSampleAt ? formatAge(row.lastSampleAt, nowMs, locale) : t("publicStatus.node.neverSampled")}</td>
								<td className="px-2 py-2 text-right">
									<div className="flex justify-end gap-1">
										{row.publication?.published && !row.publication.hiddenReason ? (
											<ButtonLink href={`/status/nodes/${row.publication.publicId}`} variant="ghost" size="xs" external>{t("publicStatusAdmin.nodes.view")}</ButtonLink>
										) : null}
										<ActionButton size="xs" variant="outline" onClick={() => setEditing(editStateFor(row))}>{t("publicStatusAdmin.nodes.edit")}</ActionButton>
									</div>
								</td>
							</tr>
						))}
						{!loading && rows.length === 0 ? (
							<tr>
								<td colSpan={6} className="px-2 py-6 text-center text-sm text-[var(--text-muted)]">{t("publicStatusAdmin.nodes.empty")}</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
			<nav className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("publicStatus.pagination")}>
				<ActionButton size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("publicStatus.prev")}</ActionButton>
				<span className="text-[var(--text-secondary)]">{t("publicStatusAdmin.nodes.pageOf", { page, pages: totalPages, total: data?.total ?? 0 })}</span>
				<ActionButton size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{t("publicStatus.next")}</ActionButton>
				{loading ? <span className="text-xs text-[var(--text-muted)]" role="status">{t("publicStatus.refreshing")}</span> : null}
			</nav>
			{editing ? (
				<EditDialog
					state={editing}
					metrics={metrics}
					t={t}
					onClose={() => setEditing(null)}
					onSaved={() => {
						setEditing(null);
						addToast("success", t("publicStatusAdmin.edit.saved"));
						reload();
					}}
				/>
			) : null}
		</section>
	);
}

export function PublicStatusAdminClient({ initialSite }: { initialSite: PublicSiteConfig }) {
	const { t } = useI18n();
	return (
		<div className="flex flex-col gap-6">
			<Notice tone="info">{t("publicStatusAdmin.privacy")}</Notice>
			<SiteSettings initial={initialSite} t={t} />
			<NodePublication metrics={initialSite.metrics} t={t} />
		</div>
	);
}
