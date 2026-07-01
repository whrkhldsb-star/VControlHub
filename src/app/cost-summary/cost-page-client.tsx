"use client";

import { useCallback, useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { EmptyState } from "@/components/page-shell";

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

const CATEGORIES: CostCategory[] = ["vps", "bandwidth", "storage", "other"];

const cardClass = "rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.04] p-5";
const labelClass = "text-xs font-medium text-[var(--text-secondary)] tracking-wide";
const inputClass =
	"w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-cyan-400/30";
const buttonPrimary =
	"rounded-lg bg-cyan-500/80 hover:bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-900 transition disabled:opacity-50 disabled:cursor-not-allowed";
const buttonGhost =
	"rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] hover:bg-[var(--surface)]/[0.10] px-4 py-2 text-sm text-[var(--text-primary)] transition";
const buttonDanger =
	"rounded-lg border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 text-xs text-rose-200 transition";

function formatAmount(amount: string, currency: CostCurrency, locale: string): string {
	const num = Number(amount);
	if (!Number.isFinite(num)) return `${amount} ${currency}`;
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
		}).format(num);
	} catch {
		return `${num.toFixed(2)} ${currency}`;
	}
}

function emptyForm(): {
	category: CostCategory;
	provider: string;
	amount: string;
	currency: CostCurrency;
	effectiveDate: string;
	notes: string;
} {
	return {
		category: "vps",
		provider: "",
		amount: "",
		currency: "CNY",
		effectiveDate: new Date().toISOString().slice(0, 10),
		notes: "",
	};
}

function isValidDate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime());
}

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
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<{ id: string; provider: string; amount: string } | null>(null);

	const localeTag = locale === "en" ? "en-US" : "zh-CN";

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
				text={t("costPage.error.load")}
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
								<title>{`${p.date}: ${p.total.toFixed(2)} ${currency}`}</title>
							</circle>
						))}
					</svg>
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

			{/* Create / edit modal */}
			{showForm && canManage ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
					role="dialog"
					aria-modal="true"
				>
					<div className={`${cardClass} w-full max-w-md space-y-4`}>
						<h3 className="text-base font-semibold text-[var(--text-primary)]">
							{editingId ? t("costPage.form.editTitle") : t("costPage.form.title")}
						</h3>
						<div>
							<label className={labelClass} htmlFor="cost-category">
								{t("costPage.form.category")}
							</label>
							<select
								id="cost-category"
								className={inputClass}
								value={form.category}
								onChange={(e) => setForm({ ...form, category: e.target.value as CostCategory })}
							>
								{CATEGORIES.map((c) => (
									<option key={c} value={c}>
										{t(`costPage.category.${c}`)}
									</option>
								))}
							</select>
						</div>
						<div>
							<label className={labelClass} htmlFor="cost-provider">
								{t("costPage.form.provider")}
							</label>
							<input
								id="cost-provider"
								className={inputClass}
								placeholder={t("costPage.form.providerPlaceholder")}
								value={form.provider}
								onChange={(e) => setForm({ ...form, provider: e.target.value })}
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className={labelClass} htmlFor="cost-amount">
									{t("costPage.form.amount")}
								</label>
								<input
									id="cost-amount"
									className={`${inputClass} font-mono`}
									inputMode="decimal"
									placeholder={t("costPage.form.amountPlaceholder")}
									value={form.amount}
									onChange={(e) => setForm({ ...form, amount: e.target.value })}
								/>
							</div>
							<div>
								<label className={labelClass} htmlFor="cost-currency">
									{t("costPage.form.currency")}
								</label>
								<select
									id="cost-currency"
									className={inputClass}
									value={form.currency}
									onChange={(e) => setForm({ ...form, currency: e.target.value as CostCurrency })}
								>
									{availableCurrencies.map((c) => (
										<option key={c} value={c}>
											{t(`costPage.currency.${c}`)}
										</option>
									))}
								</select>
							</div>
						</div>
						<div>
							<label className={labelClass} htmlFor="cost-effective-date">
								{t("costPage.form.effectiveDate")}
							</label>
							<input
								id="cost-effective-date"
								type="date"
								className={inputClass}
								value={form.effectiveDate}
								onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
							/>
						</div>
						<div>
							<label className={labelClass} htmlFor="cost-notes">
								{t("costPage.form.notes")}
							</label>
							<textarea
								id="cost-notes"
								className={`${inputClass} min-h-[60px]`}
								placeholder={t("costPage.form.notesPlaceholder")}
								value={form.notes}
								onChange={(e) => setForm({ ...form, notes: e.target.value })}
							/>
						</div>
						<div className="flex justify-end gap-2 pt-2">
							<button
								type="button"
								className={buttonGhost}
								onClick={() => {
									setShowForm(false);
									setEditingId(null);
								}}
								disabled={saving}
							>
								{t("costPage.form.cancel")}
							</button>
							<button
								type="button"
								className={buttonPrimary}
								onClick={submitForm}
								disabled={saving}
							>
								{saving ? t("costPage.actions.saving") : t("costPage.form.submit")}
							</button>
						</div>
					</div>
				</div>
			) : null}

			{/* Delete confirm */}
			{confirmDelete ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
					role="alertdialog"
					aria-modal="true"
				>
					<div className={`${cardClass} w-full max-w-sm space-y-4`}>
						<h3 className="text-base font-semibold text-[var(--text-primary)]">
							{t("costPage.delete.title")}
						</h3>
						<p className="text-sm text-[var(--text-primary)]/70">
							{t("costPage.delete.confirm")
								.replace("{provider}", confirmDelete.provider)
								.replace("{amount}", confirmDelete.amount)}
						</p>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								className={buttonGhost}
								onClick={() => setConfirmDelete(null)}
								disabled={deletingId === confirmDelete.id}
							>
								{t("costPage.delete.cancel")}
							</button>
							<button
								type="button"
								className={buttonPrimary}
								onClick={onConfirmDelete}
								disabled={deletingId === confirmDelete.id}
							>
								{deletingId === confirmDelete.id
									? t("costPage.actions.deleting")
									: t("costPage.delete.confirmBtn")}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
