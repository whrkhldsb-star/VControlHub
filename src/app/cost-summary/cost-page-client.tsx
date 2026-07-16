"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { EmptyState, ListPanel } from "@/components/page-shell";
import { CostDeleteDialog, CostEntryFormModal } from "./cost-entry-dialogs";
import { CostBudgetPanel } from "./cost-budget-panel";
import { CostCloudBillingPanel } from "./cost-cloud-billing-panel";
import {
	CATEGORIES,
	buttonDanger,
	buttonGhost,
	buttonPrimary,
	cardClass,
	formatAmount,
	inputClass,
	labelClass,
} from "./cost-page-shared";
import { useCostPageState } from "./use-cost-page-state";

import type { CloudBillingAccountRecord } from "@/lib/cost/cloud-billing/types";
import type {
	CostCurrency,
	CostEntryRecord,
	CostSummary,
	DailySnapshot,
	CostBudgetRecord,
} from "@/lib/cost/types";
// csrfFetch kept in hook

type Props = {
	initialMonth: string;
	initialCurrency: CostCurrency;
	initialSummary: CostSummary | null;
	initialEntries: CostEntryRecord[];
	initialSnapshots: DailySnapshot[];
	initialBudgets: CostBudgetRecord[];
	initialBillingAccounts: CloudBillingAccountRecord[];
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
	initialBudgets,
	initialBillingAccounts,
	canRead,
	canManage,
	availableCurrencies,
}: Props) {
	const { t, locale } = useI18n();
	const { addToast } = useToast();
	const state = useCostPageState({
		initialMonth,
		initialCurrency,
		initialSummary,
		initialEntries,
		initialSnapshots,
		initialBudgets,
		canManage,
		t,
		locale: locale as "zh" | "en",
		addToast,
	});

	if (!canRead) {
		return <EmptyState text={t("costPage.noPermission")} variant="boxed" />;
	}

	const {
		month,
		currency,
		summary,
		entries,
		showForm,
		editingId,
		form,
		saving,
		syncingSources,
		deletingId,
		confirmDelete,
		localeTag,
		trend,
		setForm,
		setShowForm,
		setEditingId,
		setConfirmDelete,
		refreshAll,
		syncServerCosts,
		onChangeMonth,
		onChangeCurrency,
		openCreate,
		openEdit,
		submitForm,
		onConfirmDelete,
		requestDelete,
	} = state;

	return (
		<div className="space-y-6">
			<CostBudgetPanel initialBudgets={initialBudgets} canManage={canManage} currencies={availableCurrencies} />
			<CostCloudBillingPanel
				initialAccounts={initialBillingAccounts}
				canManage={canManage}
				currencies={availableCurrencies}
				month={month}
				onImported={() => void refreshAll()}
			/>
			<section className={cardClass}>
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-lg font-semibold text-[var(--text-primary)]">{t("costPage.summary.title")}</h2>
					<div className="flex flex-wrap gap-2">
						<label className={labelClass}>
							{t("costPage.actions.filterMonth")}
							<input
								type="month"
								value={month}
								onChange={(e) => void onChangeMonth(e.target.value)}
								className={`${inputClass} ml-2 w-40`}
								aria-label={t("costPage.actions.filterMonth")}
							/>
						</label>
						<label className={labelClass}>
							{t("costPage.summary.currency")}
							<select
								value={currency}
								onChange={(e) => void onChangeCurrency(e.target.value as CostCurrency)}
								className={`${inputClass} ml-2 w-32`}
								aria-label={t("costPage.summary.currency")}
							>
								{availableCurrencies.map((c) => (
									<option key={c} value={c}>{t(`costPage.currency.${c}`)}</option>
								))}
							</select>
						</label>
					</div>
				</div>
				{summary ? (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div>
							<div className="text-xs uppercase tracking-wide text-[var(--text-primary)]/70">{t("costPage.summary.total")}</div>
							<div className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">{formatAmount(summary.totalAmount, summary.currency, localeTag)}</div>
							<div className="mt-1 text-xs text-[var(--text-primary)]/70">
								{t("costPage.summary.range").replace("{start}", summary.rangeStart).replace("{end}", summary.rangeEnd)}
							</div>
						</div>
						<div>
							<div className="text-xs uppercase tracking-wide text-[var(--text-primary)]/70">{t("costPage.summary.entryCount")}</div>
							<div className="mt-1 text-3xl font-semibold text-[var(--text-primary)]">{summary.entryCount}</div>
						</div>
						<div className="space-y-1">
							<div className="text-xs uppercase tracking-wide text-[var(--text-primary)]/70">{t("costPage.summary.title")}</div>
							{CATEGORIES.map((c) => (
								<div key={c} className="flex justify-between text-sm text-[var(--text-primary)]">
									<span>{t(`costPage.category.${c}`)}</span>
									<span className="font-mono">{formatAmount(summary.byCategory[c] ?? "0.00", summary.currency, localeTag)}</span>
								</div>
							))}
						</div>
					</div>
				) : (
					<div className="text-sm text-[var(--text-primary)]/70">{t("costPage.summary.noData")}</div>
				)}
			</section>

			{trend.length > 1 ? (
				<section className={cardClass}>
					<h2 className="mb-3 text-base font-semibold text-[var(--text-primary)]">{t("costPage.snapshot.title")}</h2>
					{trend.every((p) => p.total === 0) ? (
						<div className="text-sm text-[var(--text-muted)]">{t("costPage.snapshot.noTrendData")}</div>
					) : (
						<svg viewBox={`0 0 ${trend.length * 60} 80`} className="h-20 w-full" aria-label={t("costPage.snapshot.title")}>
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

			<ListPanel
				title={t("costPage.list.title")}
				count={entries.length}
				actions={
					<div className="flex flex-wrap gap-2">
						<button type="button" className={buttonGhost} onClick={() => void refreshAll()}>{t("costPage.actions.refresh")}</button>
						{canManage ? (
							<button type="button" className={buttonGhost} onClick={() => void syncServerCosts()} disabled={syncingSources}>
								{syncingSources ? t("costPage.actions.syncingSources") : t("costPage.actions.syncSources")}
							</button>
						) : null}
						{canManage ? (
							<button type="button" className={buttonPrimary} onClick={openCreate}>{t("costPage.actions.newEntry")}</button>
						) : null}
					</div>
				}
				empty={entries.length === 0 ? <EmptyState text={t("costPage.list.empty")} variant="boxed" /> : undefined}
				bodyClassName={entries.length === 0 ? undefined : "!p-0"}
			>
				{entries.length > 0 ? (
					<div className="overflow-x-auto">
						<table className="w-full text-sm text-[var(--text-primary)]">
							<thead>
								<tr className="border-b border-[var(--border)] bg-[var(--surface-elevated)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
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
										<td className="px-3 py-2 text-right font-mono">{formatAmount(e.amount, e.currency, localeTag)}</td>
										<td className="px-3 py-2 text-[var(--text-primary)]/70">{e.notes ?? "—"}</td>
										{canManage ? (
											<td className="px-3 py-2 text-right">
												<div className="flex justify-end gap-2">
													<button type="button" className={buttonGhost} onClick={() => openEdit(e)}>{t("costPage.actions.edit")}</button>
													<button type="button" className={buttonDanger} onClick={() => requestDelete(e)} disabled={deletingId === e.id}>
														{deletingId === e.id ? t("costPage.actions.deleting") : t("costPage.actions.delete")}
													</button>
												</div>
											</td>
										) : null}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</ListPanel>

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
