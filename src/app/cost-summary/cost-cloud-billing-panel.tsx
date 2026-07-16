"use client";

import { useCallback, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type {
	CloudBillingAccountRecord,
	CloudBillingProvider,
} from "@/lib/cost/cloud-billing/types";
import type { CostCurrency } from "@/lib/cost/types";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";

import { cardClass, inputClass } from "./cost-page-shared";

const PROVIDERS: CloudBillingProvider[] = ["aws", "aliyun", "tencent", "generic_csv"];

const EMPTY_CSV_SAMPLE = `date,amount,currency,category,product,notes
2026-07-01,10.00,USD,vps,ec2,sample compute
2026-07-02,2.50,USD,bandwidth,data-transfer,sample bandwidth
`;

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
	const { t } = useI18n();
	const { addToast } = useToast();
	const [accounts, setAccounts] = useState(initialAccounts);
	const [busy, setBusy] = useState(false);
	const [syncingId, setSyncingId] = useState<string | null>(null);
	const [form, setForm] = useState({
		name: "",
		provider: "generic_csv" as CloudBillingProvider,
		currency: "USD" as CostCurrency,
		accessKeyId: "",
		secretAccessKey: "",
		region: "",
		sampleCsv: EMPTY_CSV_SAMPLE,
		billingCsvUrl: "",
	});

	const reload = useCallback(async () => {
		const data = (await csrfFetch("/api/cost/billing-accounts")) as {
			accounts?: CloudBillingAccountRecord[];
		};
		if (Array.isArray(data.accounts)) setAccounts(data.accounts);
	}, []);

	const create = async () => {
		if (!form.name.trim()) return;
		setBusy(true);
		try {
			const body: Record<string, unknown> = {
				name: form.name.trim(),
				provider: form.provider,
				currency: form.currency,
				credentials:
					form.provider === "generic_csv"
						? {}
						: {
								accessKeyId: form.accessKeyId.trim(),
								secretAccessKey: form.secretAccessKey.trim(),
							},
				config: {
					...(form.region.trim() ? { region: form.region.trim() } : {}),
					...(form.provider === "generic_csv" || form.sampleCsv.trim()
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
			setForm((c) => ({
				...c,
				name: "",
				accessKeyId: "",
				secretAccessKey: "",
			}));
			await reload();
			addToast("success", t("costPage.billing.created"));
		} catch (error) {
			addToast("error", error instanceof Error ? error.message : t("costPage.billing.error"));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (id: string) => {
		setBusy(true);
		try {
			await csrfFetch(`/api/cost/billing-accounts/${id}`, { method: "DELETE" });
			await reload();
			addToast("success", t("costPage.billing.deleted"));
		} catch (error) {
			addToast("error", error instanceof Error ? error.message : t("costPage.billing.error"));
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
			addToast(
				"success",
				t("costPage.billing.syncDone")
					.replace("{imported}", String(data.result.imported))
					.replace("{skipped}", String(data.result.skipped)),
			);
			onImported?.();
		} catch (error) {
			addToast(
				"error",
				`${t("costPage.billing.syncError")}: ${error instanceof Error ? error.message : String(error)}`,
			);
			await reload();
		} finally {
			setSyncingId(null);
		}
	};

	return (
		<section className={cardClass}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-lg font-semibold text-[var(--text-primary)]">
						{t("costPage.billing.title")}
					</h2>
					<p className="mt-1 text-xs text-[var(--text-muted)]">{t("costPage.billing.desc")}</p>
				</div>
			</div>

			{canManage ? (
				<div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
					<input
						className={inputClass}
						value={form.name}
						onChange={(e) => setForm({ ...form, name: e.target.value })}
						placeholder={t("costPage.billing.name")}
						aria-label={t("costPage.billing.name")}
					/>
					<select
						className={inputClass}
						value={form.provider}
						onChange={(e) =>
							setForm({ ...form, provider: e.target.value as CloudBillingProvider })
						}
						aria-label={t("costPage.billing.provider")}
					>
						{PROVIDERS.map((p) => (
							<option key={p} value={p}>
								{t(`costPage.billing.provider.${p}`)}
							</option>
						))}
					</select>
					<select
						className={inputClass}
						value={form.currency}
						onChange={(e) => setForm({ ...form, currency: e.target.value as CostCurrency })}
						aria-label={t("costPage.billing.currency")}
					>
						{currencies.map((c) => (
							<option key={c} value={c}>
								{c}
							</option>
						))}
					</select>
					{form.provider !== "generic_csv" ? (
						<>
							<input
								className={inputClass}
								value={form.accessKeyId}
								onChange={(e) => setForm({ ...form, accessKeyId: e.target.value })}
								placeholder={t("costPage.billing.accessKeyId")}
								autoComplete="off"
							/>
							<input
								className={inputClass}
								type="password"
								value={form.secretAccessKey}
								onChange={(e) => setForm({ ...form, secretAccessKey: e.target.value })}
								placeholder={t("costPage.billing.secretAccessKey")}
								autoComplete="new-password"
							/>
							<input
								className={inputClass}
								value={form.region}
								onChange={(e) => setForm({ ...form, region: e.target.value })}
								placeholder={t("costPage.billing.region")}
							/>
						</>
					) : null}
					<input
						className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
						value={form.billingCsvUrl}
						onChange={(e) => setForm({ ...form, billingCsvUrl: e.target.value })}
						placeholder={t("costPage.billing.billingCsvUrl")}
						aria-label={t("costPage.billing.billingCsvUrl")}
					/>
					{form.provider === "generic_csv" || form.sampleCsv ? (
						<textarea
							className={`${inputClass} md:col-span-2 lg:col-span-3 min-h-[88px] font-mono text-xs`}
							value={form.sampleCsv}
							onChange={(e) => setForm({ ...form, sampleCsv: e.target.value })}
							placeholder={t("costPage.billing.sampleCsv")}
							aria-label={t("costPage.billing.sampleCsv")}
						/>
					) : null}
					<div className="md:col-span-2 lg:col-span-3">
						<ActionButton type="button" disabled={busy} onClick={() => void create()} className="px-3 py-2 text-sm">
							{t("costPage.billing.create")}
						</ActionButton>
					</div>
				</div>
			) : null}

			<div className="mt-4 grid gap-3 md:grid-cols-2">
				{accounts.length === 0 ? (
					<p className="text-sm text-[var(--text-muted)]">{t("costPage.billing.empty")}</p>
				) : (
					accounts.map((account) => (
						<article key={account.id} className="rounded-2xl border border-[var(--border)] p-4">
							<div className="flex items-start justify-between gap-3">
								<div>
									<h3 className="font-medium text-[var(--text-primary)]">{account.name}</h3>
									<p className="text-xs text-[var(--text-muted)]">
										{t(`costPage.billing.provider.${account.provider}`)} · {account.currency}
										{account.enabled ? "" : ` · ${t("costPage.billing.disabled")}`}
									</p>
								</div>
								{canManage ? (
									<button
										type="button"
										onClick={() => void remove(account.id)}
										className="text-xs text-[var(--danger)]"
										disabled={busy}
									>
										{t("costPage.billing.delete")}
									</button>
								) : null}
							</div>
							<p className="mt-2 text-xs text-[var(--text-secondary)]">
								{account.lastSyncAt
									? t("costPage.billing.lastSync")
											.replace("{status}", account.lastSyncStatus ?? "—")
											.replace("{at}", account.lastSyncAt.slice(0, 19).replace("T", " "))
											.replace("{imported}", String(account.lastSyncImported))
									: t("costPage.billing.neverSynced")}
							</p>
							{account.lastSyncError ? (
								<p className="mt-1 text-xs text-[var(--danger)]">{account.lastSyncError}</p>
							) : null}
							{canManage ? (
								<button
									type="button"
									className="mt-3 rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs"
									disabled={syncingId === account.id || !account.enabled}
									onClick={() => void sync(account.id)}
								>
									{syncingId === account.id
										? t("costPage.billing.syncing")
										: t("costPage.billing.sync").replace("{month}", month)}
								</button>
							) : null}
						</article>
					))
				)}
			</div>
		</section>
	);
}
