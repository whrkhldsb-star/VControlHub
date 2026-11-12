"use client";

import { useCallback, useId, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/page-shell";
import { Badge, FormField, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type {
	CloudBillingAccountRecord,
	CloudBillingProvider,
} from "@/lib/cost/cloud-billing/types";
import type { CostCurrency } from "@/lib/cost/types";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";

import { inputClass } from "./cost-page-shared";
import { formatDateTime } from "@/lib/datetime/format";
import { describeFailure, getErrorMessage } from "@/lib/http/error-message";

const PROVIDERS: CloudBillingProvider[] = ["aws", "aliyun", "tencent", "generic_csv"];

type Props = {
	initialAccounts: CloudBillingAccountRecord[];
	canManage: boolean;
	currencies: CostCurrency[];
	month: string;
	onImported?: () => void;
};

export function CostCloudBillingPanel({
	initialAccounts,
	canManage,
	currencies,
	month,
	onImported,
}: Props) {
	const { t, locale } = useI18n();
	const { addToast } = useToast();
	const [accounts, setAccounts] = useState(initialAccounts);
	const [busy, setBusy] = useState(false);
	const [syncingId, setSyncingId] = useState<string | null>(null);
	const [pendingDelete, setPendingDelete] = useState<CloudBillingAccountRecord | null>(null);
	const [creating, setCreating] = useState(false);
	// Why the account was not added, by the button; why one was not deleted, in the dialog that asked.
	const [formError, setFormError] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const fieldId = useId();
	const [form, setForm] = useState({
		name: "",
		provider: "generic_csv" as CloudBillingProvider,
		currency: "USD" as CostCurrency,
		region: "",
		sampleCsv: "",
		billingCsvUrl: "",
	});

	const reload = useCallback(async () => {
		const data = (await csrfFetch("/api/cost/billing-accounts")) as {
			accounts?: CloudBillingAccountRecord[];
		};
		if (Array.isArray(data.accounts)) setAccounts(data.accounts);
	}, []);

	const update = (change: Partial<typeof form>) => {
		setFormError(null);
		setForm((current) => ({ ...current, ...change }));
	};

	const create = async () => {
		setFormError(null);
		if (!form.name.trim()) {
			setFormError(t("costPage.billing.error.nameRequired"));
			return;
		}
		const submitted = form;
		setCreating(true);
		try {
			const body: Record<string, unknown> = {
				name: form.name.trim(),
				provider: form.provider,
				currency: form.currency,
				credentials: {},
				config: {
					...(form.region.trim() ? { region: form.region.trim() } : {}),
					...(form.sampleCsv.trim()
						? { sampleCsv: form.sampleCsv }
						: {}),
					...(form.billingCsvUrl.trim()
						? { billingCsvUrl: form.billingCsvUrl.trim() }
						: {}),
				},
			};
			await csrfFetch("/api/cost/billing-accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			// Clear only what was sent: the fields stay editable while saving,
			// and a next account typed meanwhile used to be wiped here.
			setForm((c) => ({
				...c,
				name: c.name === submitted.name ? "" : c.name,
				sampleCsv: c.sampleCsv === submitted.sampleCsv ? "" : c.sampleCsv,
				billingCsvUrl: c.billingCsvUrl === submitted.billingCsvUrl ? "" : c.billingCsvUrl,
			}));
			await reload();
			addToast("success", t("costPage.billing.created"));
		} catch (error) {
			setFormError(getErrorMessage(error, t("costPage.billing.error")));
		} finally {
			setCreating(false);
		}
	};

	const remove = async () => {
		if (!pendingDelete) return;
		setBusy(true);
		setDeleteError(null);
		try {
			await csrfFetch(`/api/cost/billing-accounts/${pendingDelete.id}`, { method: "DELETE" });
			setPendingDelete(null);
			await reload();
			addToast("success", t("costPage.billing.deleted"));
		} catch (error) {
			setDeleteError(getErrorMessage(error, t("costPage.billing.error")));
		} finally {
			setBusy(false);
		}
	};

	const sync = async (id: string) => {
		setSyncingId(id);
		try {
			const data = (await csrfFetch(`/api/cost/billing-accounts/${id}/sync`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ month }),
			})) as {
				result: { imported: number; skipped: number; warnings?: string[] };
			};
			await reload();
			const summary = t("costPage.billing.syncDone", { imported: data.result.imported, skipped: data.result.skipped });
			const warnings = data.result.warnings ?? [];
			addToast(
				warnings.length > 0 ? "warning" : "success",
				warnings.length > 0 ? `${summary} ${warnings.join("; ")}` : summary,
			);
			onImported?.();
		} catch (error) {
			addToast("error", describeFailure(t("costPage.billing.syncError"), error));
			await reload();
		} finally {
			setSyncingId(null);
		}
	};

	return (
		<section data-card className="p-5">
			<ConfirmDialog
				open={pendingDelete !== null}
				title={t("costPage.billing.deleteTitle")}
				description={t("costPage.billing.deleteConfirm", { name: pendingDelete?.name ?? "" })}
				cancelLabel={t("costPage.billing.deleteCancel")}
				confirmLabel={t("costPage.billing.deleteConfirmBtn")}
				onCancel={() => { setPendingDelete(null); setDeleteError(null); }}
				onConfirm={() => void remove()}
				busy={busy}
				error={deleteError ?? undefined}
			/>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="ui-title-section">
						{t("costPage.billing.title")}
					</h2>
					<p className="mt-1 text-xs text-[var(--text-muted)]">{t("costPage.billing.desc")}</p>
				</div>
			</div>

			{canManage ? (
				<form
					className="mt-4 flex flex-col gap-3"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void create();
					}}
				>
					<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
						<FormField label={t("costPage.billing.name")} htmlFor={`${fieldId}-name`}>
							<input
								id={`${fieldId}-name`}
								className={inputClass}
								maxLength={128}
								value={form.name}
								onChange={(e) => update({ name: e.target.value })}
							/>
						</FormField>
						<FormField label={t("costPage.billing.provider")} htmlFor={`${fieldId}-provider`}>
							<select
								id={`${fieldId}-provider`}
								className={inputClass}
								value={form.provider}
								onChange={(e) => update({ provider: e.target.value as CloudBillingProvider })}
							>
								{PROVIDERS.map((p) => (
									<option key={p} value={p}>
										{t(`costPage.billing.provider.${p}`)}
									</option>
								))}
							</select>
						</FormField>
						<FormField label={t("costPage.billing.currency")} htmlFor={`${fieldId}-currency`}>
							<select
								id={`${fieldId}-currency`}
								className={inputClass}
								value={form.currency}
								onChange={(e) => update({ currency: e.target.value as CostCurrency })}
							>
								{currencies.map((c) => (
									<option key={c} value={c}>
										{t(`costPage.currency.${c}`)}
									</option>
								))}
							</select>
						</FormField>
						{form.provider !== "generic_csv" ? (
							<FormField label={t("costPage.billing.region")} htmlFor={`${fieldId}-region`}>
								<input
									id={`${fieldId}-region`}
									className={inputClass}
									value={form.region}
									onChange={(e) => update({ region: e.target.value })}
								/>
							</FormField>
						) : null}
					</div>
					<FormField label={t("costPage.billing.billingCsvUrl")} htmlFor={`${fieldId}-url`} hint={t("costPage.billing.billingCsvUrlHint")}>
						<input
							id={`${fieldId}-url`}
							type="url"
							inputMode="url"
							className={inputClass}
							value={form.billingCsvUrl}
							onChange={(e) => update({ billingCsvUrl: e.target.value })}
							placeholder="https://"
						/>
					</FormField>
					<FormField label={t("costPage.billing.sampleCsv")} htmlFor={`${fieldId}-csv`} hint={t("costPage.billing.sampleCsvHint")}>
						<textarea
							id={`${fieldId}-csv`}
							className={`${inputClass} min-h-[88px] font-mono text-xs`}
							value={form.sampleCsv}
							onChange={(e) => update({ sampleCsv: e.target.value })}
						/>
					</FormField>
					{formError ? <Notice tone="danger">{formError}</Notice> : null}
					<div>
						<ActionButton type="submit" variant="outline" loading={creating}>
							{t("costPage.billing.create")}
						</ActionButton>
					</div>
				</form>
			) : null}

			<div className="mt-4 grid gap-3 md:grid-cols-2">
				{accounts.length === 0 ? (
					<div className="md:col-span-2">
						<EmptyState title={t("costPage.billing.empty")} text={t("costPage.billing.emptyHint")} />
					</div>
				) : (
					accounts.map((account) => (
						<article key={account.id} data-inset className="p-4">
							<div className="flex items-start justify-between gap-3">
								<div>
									<h3 className="ui-title-group">{account.name}</h3>
									<p className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
										{t("costPage.billing.meta", { provider: t(`costPage.billing.provider.${account.provider}`), currency: t(`costPage.currency.${account.currency}`) })}
										{account.enabled ? null : <Badge>{t("costPage.billing.disabled")}</Badge>}
									</p>
								</div>
								{canManage ? (
									<ActionButton size="xs" variant="danger"
										onClick={() => { setDeleteError(null); setPendingDelete(account); }}
										disabled={busy}
									>
										{t("costPage.billing.delete")}
									</ActionButton>
								) : null}
							</div>
							<p className="mt-2 text-xs text-[var(--text-secondary)]">
								{account.lastSyncAt
									? t("costPage.billing.lastSync", {
										status: account.lastSyncStatus ? t(`costPage.billing.status.${account.lastSyncStatus}`) : "—",
										at: formatDateTime(account.lastSyncAt, locale),
										imported: account.lastSyncImported,
									})
									: t("costPage.billing.neverSynced")}
							</p>
							{account.lastSyncError ? (
								<p className="mt-1 text-xs text-[var(--danger)]">{account.lastSyncError}</p>
							) : null}
							{canManage ? (
								<div className="mt-3">
									<ActionButton size="sm" variant="secondary"
										disabled={syncingId === account.id || !account.enabled}
										onClick={() => void sync(account.id)}
									>
										{syncingId === account.id
											? t("costPage.billing.syncing")
											: t("costPage.billing.sync", { month })}
									</ActionButton>
								</div>
							) : null}
						</article>
					))
				)}
			</div>
		</section>
	);
}
