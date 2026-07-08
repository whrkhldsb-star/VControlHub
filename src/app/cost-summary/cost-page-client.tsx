"use client";

import { useCallback, useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useToast } from "@/components/toast-provider";
import { EmptyState } from "@/components/page-shell";
import { CostDeleteDialog, CostEntryFormModal } from "./cost-entry-dialogs";
import { CATEGORIES, buttonDanger, buttonGhost, buttonPrimary, cardClass, emptyForm, formatAmount, inputClass, isValidDate, labelClass } from "./cost-page-shared";

import type {
	CostCategory,
	CostCurrency,
	CostEntryRecord,
	CostSummary,
	DailySnapshot,
} from "@/lib/cost/types";

type Props = {
	initialMonth: string;
	initialCurrency: CostCurrency;
	initialSummary: CostSummary | null;
	initialEntries: CostEntryRecord[];
	initialSnapshots: DailySnapshot[];
	canRead: boolean;
	canManage: boolean;
	availableCurrencies: CostCurrency[];
};

export type { CostCurrency };

export function CostPageClient({
	initialMonth,
	initialCurrency,
	initialSummary,
	initialEntries,
	initialSnapshots,
	canRead,
	canManage,
	availableCurrencies,
}: Props) {
	const { t, locale } = useI18n();
	const { addToast } = useToast();

	const [month, setMonth] = useState(initialMonth);
	const [currency, setCurrency] = useState<CostCurrency>(initialCurrency);
	const [summary, setSummary] = useState<CostSummary | null>(initialSummary);
	const [entries, setEntries] = useState<CostEntryRecord[]>(initialEntries);
	const [snapshots, setSnapshots] = useState<DailySnapshot[]>(initialSnapshots);

	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [form, setForm] = useState(emptyForm());
	const [saving, setSaving] = useState(false);
	const [syncingSources, setSyncingSources] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<{ id: string; provider: string; amount: string } | null>(null);

	const localeTag = toDateLocale(locale);

	const fetchSummary = useCallback(
		async (m: string, c: CostCurrency) => {
			try {
				const res = await csrfFetch<Response>(`/api/cost/summary?month=${m}&currency=${c}`, {
					raw: true,
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as { summary: CostSummary };
				setSummary(data.summary);
			} catch (err) {
				addToast(
					"error",
					`${t("costPage.error.load")}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		},
		[addToast, t],
	);

	const fetchEntries = useCallback(async () => {
		try {
			const res = await csrfFetch<Response>(`/api/cost/entries?limit=200`, {
				raw: true,
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { entries: CostEntryRecord[] };
			setEntries(data.entries);
		} catch (err) {
			addToast(
				"error",
				`${t("costPage.error.load")}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}, [addToast, t]);

	const fetchSnapshots = useCallback(async () => {
		try {
			const res = await csrfFetch<Response>(`/api/cost/snapshots?limit=30`, {
				raw: true,
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { snapshots: DailySnapshot[] };
			setSnapshots(data.snapshots);
		} catch {
			// non-blocking
		}
	}, []);

	const refreshAll = useCallback(async () => {
		await Promise.all([fetchSummary(month, currency), fetchEntries(), fetchSnapshots()]);
	}, [fetchSummary, fetchEntries, fetchSnapshots, month, currency]);

	const syncServerCosts = useCallback(async () => {
		if (!canManage) return;
		setSyncingSources(true);
		try {
			const res = await csrfFetch<Response>("/api/cost/snapshots", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ month }),
				raw: true,
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message ?? `HTTP ${res.status}`);
			}
			const data = (await res.json()) as { result: { synced: number; skipped: number } };
			addToast(
				"success",
				t("costPage.actions.syncSourcesDone")
					.replace("{synced}", String(data.result.synced))
					.replace("{skipped}", String(data.result.skipped)),
			);
			await refreshAll();
		} catch (err) {
			addToast(
				"error",
				`${t("costPage.actions.syncSourcesError")}: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setSyncingSources(false);
		}
	}, [addToast, canManage, month, refreshAll, t]);

	const onChangeMonth = useCallback(
		async (m: string) => {
			setMonth(m);
			await fetchSummary(m, currency);
		},
		[currency, fetchSummary],
	);

	const onChangeCurrency = useCallback(
		async (c: CostCurrency) => {
			setCurrency(c);
			await fetchSummary(month, c);
		},
		[month, fetchSummary],
	);

	const openCreate = () => {
		setEditingId(null);
		setForm(emptyForm());
		setShowForm(true);
	};

	const openEdit = (e: CostEntryRecord) => {
		setEditingId(e.id);
		setForm({
			category: e.category,
			provider: e.provider,
			amount: e.amount,
			currency: e.currency,
			effectiveDate: e.effectiveDate,
			notes: e.notes ?? "",
		});
		setShowForm(true);
	};

	const submitForm = async () => {
		if (!canManage) return;
		if (!form.provider.trim() || !form.amount.trim() || !isValidDate(form.effectiveDate)) {
			addToast("error", t("costPage.form.error.required"));
			return;
		}
		setSaving(true);
		try {
			const payload = {
				category: form.category,
				provider: form.provider.trim(),
				amount: form.amount.trim(),
				currency: form.currency,
				effectiveDate: form.effectiveDate,
				notes: form.notes.trim() || null,
			};
			const url = editingId ? `/api/cost/entries/${editingId}` : "/api/cost/entries";
			const method = editingId ? "PATCH" : "POST";
			const res = await csrfFetch<Response>(url, {
				method,
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
				raw: true,
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message ?? `HTTP ${res.status}`);
			}
			setShowForm(false);
			setEditingId(null);
			addToast("success", t("costPage.form.submit"));
			await refreshAll();
		} catch (err) {
			addToast(
				"error",
				`${t("costPage.error.save")}: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setSaving(false);
		}
	};

	const onConfirmDelete = async () => {
		if (!confirmDelete) return;
		setDeletingId(confirmDelete.id);
		try {
			const res = await csrfFetch<Response>(`/api/cost/entries/${confirmDelete.id}`, {
				method: "DELETE",
				raw: true,
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setConfirmDelete(null);
			addToast("success", t("costPage.delete.confirmBtn"));
			await refreshAll();
		} catch (err) {
			addToast(
				"error",
				`${t("costPage.error.delete")}: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setDeletingId(null);
		}
	};

	const trend = useMemo(() => {
		return [...snapshots]
			.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
			.slice(-14)
			.map((s) => ({
				date: s.snapshotDate.slice(5), // MM-DD
				total: Number(s.totalAmount),
			}));
	}, [snapshots]);

	if (!canRead) {
		return (
			<EmptyState
				text={t("costPage.noPermission")}
				variant="boxed"
			/>
		);
	}

	return (
		<div className="space-y-6">
			{/* Summary card */}
			<section className={cardClass}>
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-lg font-semibold text-[var(--text-primary)]">
						{t("costPage.summary.title")}
					</h2>
					<div className="flex flex-wrap gap-2">
						<label className={labelClass}>
							{t("costPage.actions.filterMonth")}
							<input
								type="month"
								value={month}
								onChange={(e) => onChangeMonth(e.target.value)}
								className={`${inputClass} ml-2 w-40`}
								aria-label={t("costPage.actions.filterMonth")}
							/>
						</label>
						<label className={labelClass}>
							{t("costPage.summary.currency")}
							<select
								value={currency}
								onChange={(e) => onChangeCurrency(e.target.value as CostCurrency)}
								className={`${inputClass} ml-2 w-32`}
								aria-label={t("costPage.summary.currency")}
							>
								{availableCurrencies.map((c) => (
									<option key={c} value={c}>
										{t(`costPage.currency.${c}`)}
									</option>
								))}
							</select>
						</label>
					</div>
				</div>
				{summary ? (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div>
							<div className="text-xs uppercase tracking-wide text-[var(--text-primary)]/70">
								{t("costPage.summary.total")}
							</div>
							<div className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">
								{formatAmount(summary.totalAmount, summary.currency, localeTag)}
							</div>
							<div className="mt-1 text-xs text-[var(--text-primary)]/70">
								{t("costPage.summary.range")
									.replace("{start}", summary.rangeStart)
									.replace("{end}", summary.rangeEnd)}
							</div>
						</div>
						<div>
							<div className="text-xs uppercase tracking-wide text-[var(--text-primary)]/70">
								{t("costPage.summary.entryCount")}
							</div>
							<div className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">
								{summary.entryCount}
							</div>
						</div>
						<div className="space-y-1">
							<div className="text-xs uppercase tracking-wide text-[var(--text-primary)]/70">
								{t("costPage.summary.title")}
							</div>
							{CATEGORIES.map((c) => (
								<div key={c} className="flex justify-between text-sm text-[var(--text-primary)]">
									<span>{t(`costPage.category.${c}`)}</span>
									<span className="font-mono">
										{formatAmount(summary.byCategory[c] ?? "0.00", summary.currency, localeTag)}
									</span>
								</div>
							))}
						</div>
					</div>
				) : (
					<div className="text-sm text-[var(--text-primary)]/70">{t("costPage.summary.noData")}</div>
				)}
			</section>

			{/* Trend (mini sparkline area) */}
			{trend.length > 1 ? (
				<section className={cardClass}>
					<h2 className="mb-3 text-base font-semibold text-[var(--text-primary)]">
						{t("costPage.snapshot.title")}
					</h2>
					{trend.every((p) => p.total === 0) ? (
						<div className="text-sm text-[var(--text-muted)]">{t("costPage.snapshot.noTrendData")}</div>
					) : (
					<svg
						viewBox={`0 0 ${trend.length * 60} 80`}
						className="h-20 w-full"
						aria-label={t("costPage.snapshot.title")}
					>
						<polyline
							fill="none"
							stroke="rgb(34, 211, 238)"
							strokeWidth="2"
							points={trend
								.map((p, i) => `${i * 60 + 20},${80 - (p.total / Math.max(...trend.map((x) => x.total), 1)) * 70 - 5}`)
								.join(" ")}
						/>
						{trend.map((p, i) => (
							<circle
								key={p.date}
								cx={i * 60 + 20}
								cy={80 - (p.total / Math.max(...trend.map((x) => x.total), 1)) * 70 - 5}
								r="2.5"
								fill="rgb(34, 211, 238)"
							>
								<title>{`${p.date}: ${p.total.toFixed(2)} ${t(`costPage.currency.${currency}`)}`}</title>
							</circle>
						))}
					</svg>
					)}
				</section>
			) : null}

			{/* Entries list + new entry button */}
			<section className={cardClass}>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-base font-semibold text-[var(--text-primary)]">
						{t("costPage.list.title")}
					</h2>
					<div className="flex gap-2">
						<button type="button" className={buttonGhost} onClick={refreshAll}>
							{t("costPage.actions.refresh")}
						</button>
						{canManage ? (
							<button type="button" className={buttonGhost} onClick={syncServerCosts} disabled={syncingSources}>
								{syncingSources ? t("costPage.actions.syncingSources") : t("costPage.actions.syncSources")}
							</button>
						) : null}
						{canManage ? (
							<button type="button" className={buttonPrimary} onClick={openCreate}>
								{t("costPage.actions.newEntry")}
							</button>
						) : null}
					</div>
				</div>

				{entries.length === 0 ? (
					<EmptyState text={t("costPage.list.empty")} variant="boxed" />
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm text-[var(--text-primary)]">
							<thead>
								<tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--text-primary)]/70">
									<th className="px-3 py-2">{t("costPage.list.column.date")}</th>
									<th className="px-3 py-2">{t("costPage.list.column.category")}</th>
									<th className="px-3 py-2">{t("costPage.list.column.provider")}</th>
									<th className="px-3 py-2 text-right">{t("costPage.list.column.amount")}</th>
									<th className="px-3 py-2">{t("costPage.list.column.notes")}</th>
									{canManage ? <th className="px-3 py-2 text-right">{t("costPage.list.column.actions")}</th> : null}
								</tr>
							</thead>
							<tbody>
								{entries.map((e) => (
									<tr key={e.id} className="border-b border-[var(--border)]">
										<td className="px-3 py-2 font-mono text-xs">{e.effectiveDate}</td>
										<td className="px-3 py-2">{t(`costPage.category.${e.category}`)}</td>
										<td className="px-3 py-2">{e.provider}</td>
										<td className="px-3 py-2 text-right font-mono">
											{formatAmount(e.amount, e.currency, localeTag)}
										</td>
										<td className="px-3 py-2 text-[var(--text-primary)]/70">{e.notes ?? "—"}</td>
										{canManage ? (
											<td className="px-3 py-2 text-right">
												<div className="flex justify-end gap-2">
													<button
														type="button"
														className={buttonGhost}
														onClick={() => openEdit(e)}
													>
														{t("costPage.actions.edit")}
													</button>
													<button
														type="button"
														className={buttonDanger}
														onClick={() =>
															setConfirmDelete({
																id: e.id,
																provider: e.provider,
																amount: formatAmount(e.amount, e.currency, localeTag),
															})
														}
														disabled={deletingId === e.id}
													>
														{deletingId === e.id
															? t("costPage.actions.deleting")
															: t("costPage.actions.delete")}
													</button>
												</div>
											</td>
										) : null}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<CostEntryFormModal
				open={showForm && canManage}
				editingId={editingId}
				form={form}
				availableCurrencies={availableCurrencies}
				saving={saving}
				setForm={setForm}
				setShowForm={setShowForm}
				setEditingId={setEditingId}
				submitForm={submitForm}
				t={t}
			/>
			<CostDeleteDialog
				confirmDelete={confirmDelete}
				deletingId={deletingId}
				setConfirmDelete={setConfirmDelete}
				onConfirmDelete={onConfirmDelete}
				t={t}
			/>
		</div>
	);
}
