"use client";

import { useCallback, useId, useRef, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/page-shell";
import { Badge, FormField, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type {
	CloudBillingAccountConfig,
	CloudBillingAccountRecord,
	CloudBillingProvider,
} from "@/lib/cost/cloud-billing/types";
import type { CostCurrency } from "@/lib/cost/types";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";

import { inputClass } from "./cost-page-shared";
import { formatDateTime } from "@/lib/datetime/format";
import { describeFailure, getErrorMessage } from "@/lib/http/error-message";

const PROVIDERS: CloudBillingProvider[] = ["aws", "aliyun", "tencent", "generic_csv"];

/** An account as its form holds it. */
export type BillingFormValues = {
	name: string;
	provider: CloudBillingProvider;
	currency: CostCurrency;
	region: string;
	sampleCsv: string;
	billingCsvUrl: string;
};

const BLANK_FORM: BillingFormValues = {
	name: "",
	provider: "generic_csv",
	currency: "USD",
	region: "",
	sampleCsv: "",
	billingCsvUrl: "",
};

function formOf(account: CloudBillingAccountRecord): BillingFormValues {
	return {
		name: account.name,
		provider: account.provider,
		currency: account.currency,
		region: account.config.region ?? "",
		sampleCsv: account.config.sampleCsv ?? "",
		billingCsvUrl: account.config.billingCsvUrl ?? "",
	};
}

/** The settings the form edits, merged into what else the account keeps (its account id, its category map). */
function configOf(form: BillingFormValues, base: CloudBillingAccountConfig = {}): CloudBillingAccountConfig {
	const { region: _region, sampleCsv: _sampleCsv, billingCsvUrl: _billingCsvUrl, ...kept } = base;
	return {
		...kept,
		...(form.region.trim() ? { region: form.region.trim() } : {}),
		...(form.sampleCsv.trim() ? { sampleCsv: form.sampleCsv } : {}),
		...(form.billingCsvUrl.trim() ? { billingCsvUrl: form.billingCsvUrl.trim() } : {}),
	};
}

/**
 * The fields of an edited account that differ from the saved one: what the edit sends. The settings go as a whole
 * (the server replaces them), with what the form does not show kept; the provider is fixed once the account exists.
 */
export function changedBillingFields(saved: CloudBillingAccountRecord, next: BillingFormValues): { name?: string; currency?: CostCurrency; config?: CloudBillingAccountConfig } {
	const changes: { name?: string; currency?: CostCurrency; config?: CloudBillingAccountConfig } = {};
	if (next.name.trim() !== saved.name) changes.name = next.name.trim();
	if (next.currency !== saved.currency) changes.currency = next.currency;
	const was = formOf(saved);
	if (next.region.trim() !== was.region.trim() || next.billingCsvUrl.trim() !== was.billingCsvUrl.trim() || next.sampleCsv.trim() !== was.sampleCsv.trim()) {
		changes.config = configOf(next, saved.config);
	}
	return changes;
}

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
	const [togglingId, setTogglingId] = useState<string | null>(null);
	const [pendingDelete, setPendingDelete] = useState<CloudBillingAccountRecord | null>(null);
	const [submitting, setSubmitting] = useState(false);
	// Why the account was not saved, by the button; why one was not deleted, in the dialog that asked.
	const [formError, setFormError] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const fieldId = useId();
	const [form, setForm] = useState<BillingFormValues>(BLANK_FORM);
	// The account whose changes the form holds; null while it adds a new one. An account could not be changed once
	// added: a new CSV address meant deleting it, with its import settings, and adding it again.
	const [editing, setEditing] = useState<CloudBillingAccountRecord | null>(null);
	const formRef = useRef<HTMLFormElement>(null);

	const reload = useCallback(async () => {
		const data = (await csrfFetch("/api/cost/billing-accounts")) as {
			accounts?: CloudBillingAccountRecord[];
		};
		if (Array.isArray(data.accounts)) setAccounts(data.accounts);
	}, []);

	const update = (change: Partial<BillingFormValues>) => {
		setFormError(null);
		setForm((current) => ({ ...current, ...change }));
	};

	const closeEdit = () => {
		setEditing(null);
		setForm(BLANK_FORM);
		setFormError(null);
	};
	const dirty = editing !== null && Object.keys(changedBillingFields(editing, form)).length > 0;
	const { requestDiscard, discardDialog } = useUnsavedChangesGuard({ dirty, onDiscard: closeEdit });

	const startEdit = (account: CloudBillingAccountRecord) => {
		setEditing(account);
		setForm(formOf(account));
		setFormError(null);
		formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
	};

	const submit = async () => {
		setFormError(null);
		if (!form.name.trim()) {
			setFormError(t("costPage.billing.error.nameRequired"));
			return;
		}
		// A generic CSV account reads its bill from one of the two; the server checks it only when one is added.
		if (form.provider === "generic_csv" && !form.sampleCsv.trim() && !form.billingCsvUrl.trim()) {
			setFormError(t("costPage.billing.error.csvRequired"));
			return;
		}
		if (editing) {
			// An edit sends what changed, and nothing when nothing did.
			const changes = changedBillingFields(editing, form);
			if (Object.keys(changes).length === 0) {
				addToast("info", t("costPage.unchanged"));
				closeEdit();
				return;
			}
			setSubmitting(true);
			try {
				await csrfFetch(`/api/cost/billing-accounts/${editing.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(changes),
				});
				const name = form.name.trim();
				closeEdit();
				await reload();
				addToast("success", t("costPage.billing.updated", { name }));
			} catch (error) {
				setFormError(getErrorMessage(error, t("costPage.billing.error")));
			} finally {
				setSubmitting(false);
			}
			return;
		}
		const submitted = form;
		setSubmitting(true);
		try {
			const body: Record<string, unknown> = {
				name: form.name.trim(),
				provider: form.provider,
				currency: form.currency,
				credentials: {},
				config: configOf(form),
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
			setSubmitting(false);
		}
	};

	// The card said "disabled" and greyed out its sync, but nothing on the page switched an account on or off.
	const toggle = async (account: CloudBillingAccountRecord) => {
		setTogglingId(account.id);
		try {
			await csrfFetch(`/api/cost/billing-accounts/${account.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: !account.enabled }),
			});
			await reload();
			addToast("success", t(account.enabled ? "costPage.billing.disabledToast" : "costPage.billing.enabledToast", { name: account.name }));
		} catch (error) {
			addToast("error", getErrorMessage(error, t("costPage.billing.error")));
		} finally {
			setTogglingId(null);
		}
	};

	const remove = async () => {
		if (!pendingDelete) return;
		setBusy(true);
		setDeleteError(null);
		try {
			await csrfFetch(`/api/cost/billing-accounts/${pendingDelete.id}`, { method: "DELETE" });
			if (editing?.id === pendingDelete.id) closeEdit();
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
				warnings.length > 0 ? `${summary}${t("common.sentenceSeparator")}${warnings.join(t("common.sentenceSeparator"))}` : summary,
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
					ref={formRef}
					className="mt-4 flex scroll-mt-24 flex-col gap-3"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					{editing ? <h3 className="ui-title-group">{t("costPage.billing.editTitle", { name: editing.name })}</h3> : null}
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
						<FormField
							label={t("costPage.billing.provider")}
							htmlFor={`${fieldId}-provider`}
							hint={editing ? t("costPage.billing.providerFixed") : undefined}
						>
							<select
								id={`${fieldId}-provider`}
								className={inputClass}
								value={form.provider}
								disabled={editing !== null}
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
					<div className="flex flex-wrap gap-2">
						<ActionButton type="submit" variant={editing ? "primary" : "outline"} loading={submitting}>
							{editing ? t("costPage.saveChanges") : t("costPage.billing.create")}
						</ActionButton>
						{editing ? (
							<ActionButton type="button" variant="secondary" onClick={requestDiscard}>
								{t("costPage.cancelEdit")}
							</ActionButton>
						) : null}
					</div>
					{discardDialog}
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
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0">
									<h3 className="ui-title-group">{account.name}</h3>
									<p className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
										{t("costPage.billing.meta", { provider: t(`costPage.billing.provider.${account.provider}`), currency: t(`costPage.currency.${account.currency}`) })}
										{account.enabled ? null : <Badge>{t("costPage.billing.disabled")}</Badge>}
									</p>
								</div>
								{canManage ? (
									<div className="flex flex-wrap gap-2">
										<ActionButton size="xs" variant="outline"
											onClick={() => startEdit(account)}
											disabled={editing !== null}
											title={editing !== null ? t("costPage.editBusy") : undefined}>
											{t("costPage.edit")}
										</ActionButton>
										<ActionButton size="xs" variant="secondary"
											onClick={() => void toggle(account)}
											loading={togglingId === account.id}
											disabled={togglingId !== null}>
											{account.enabled ? t("costPage.billing.disable") : t("costPage.billing.enable")}
										</ActionButton>
										<ActionButton size="xs" variant="danger"
											onClick={() => { setDeleteError(null); setPendingDelete(account); }}
											disabled={busy}
										>
											{t("costPage.billing.delete")}
										</ActionButton>
									</div>
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
										title={account.enabled ? undefined : t("costPage.billing.syncDisabledHint")}
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
