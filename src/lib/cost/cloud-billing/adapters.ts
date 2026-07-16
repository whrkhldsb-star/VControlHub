/**
 * Cloud billing adapters (FEAT-COST-CLOUD-BILLING).
 *
 * Production design:
 * - Real AWS Cost Explorer / CUR, Aliyun BSS, Tencent Billing APIs require
 *   vendor SDKs and network egress. This module provides:
 *   1) Credential + month validation for all providers
 *   2) A deterministic "probe" mode when `config.sampleCsv` is set or
 *      `VCONTROLHUB_CLOUD_BILLING_MOCK=1` — used in tests and air-gapped hosts
 *   3) HTTP-ready structure so real SDK calls can replace `fetchLiveItems`
 *      without changing CostEntry upsert semantics
 *
 * Failure modes (never fake success):
 * - Missing credentials → ValidationError
 * - Adapter throw → sync run status=error with errorMessage
 * - Empty month → ok with imported=0 (legitimate empty bill)
 */
import { ValidationError } from "@/lib/errors";

import type { CostCategory, CostCurrency } from "../types";
import type {
	CloudBillingAccountConfig,
	CloudBillingCredentials,
	CloudBillingFetchResult,
	CloudBillingLineItem,
	CloudBillingProvider,
} from "./types";

function monthBounds(month: string): { start: string; end: string } {
	const [ys, ms] = month.split("-");
	const y = Number(ys);
	const m = Number(ms);
	if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
		throw new ValidationError(`Invalid billing month: ${month}`);
	}
	const start = `${ys}-${ms}-01`;
	const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
	const end = `${ys}-${ms}-${String(lastDay).padStart(2, "0")}`;
	return { start, end };
}

function requireCreds(creds: CloudBillingCredentials, provider: CloudBillingProvider) {
	if (provider === "generic_csv") {
		// CSV path may use sampleCsv only
		return;
	}
	if (!creds.accessKeyId?.trim() || !creds.secretAccessKey?.trim()) {
		throw new ValidationError(
			`Cloud billing credentials incomplete for provider ${provider}: accessKeyId and secretAccessKey are required`,
		);
	}
}

function parseCsvLine(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				cur += '"';
				i += 1;
			} else {
				inQuotes = !inQuotes;
			}
			continue;
		}
		if (ch === "," && !inQuotes) {
			out.push(cur.trim());
			cur = "";
			continue;
		}
		cur += ch;
	}
	out.push(cur.trim());
	return out;
}

/**
 * CSV columns (header required):
 * date,amount,currency,category,product,notes
 */
export function parseBillingCsv(
	csv: string,
	defaults: { currency: CostCurrency; providerLabel: string },
): CloudBillingLineItem[] {
	const lines = csv
		.split(/\r?\n/u)
		.map((l) => l.trim())
		.filter(Boolean);
	if (lines.length < 2) return [];
	const header = parseCsvLine(lines[0] ?? "").map((h) => h.toLowerCase());
	const idx = (name: string) => header.indexOf(name);
	const dateI = idx("date");
	const amountI = idx("amount");
	if (dateI < 0 || amountI < 0) {
		throw new ValidationError("CSV must include date and amount columns");
	}
	const currencyI = idx("currency");
	const categoryI = idx("category");
	const productI = idx("product");
	const notesI = idx("notes");
	const items: CloudBillingLineItem[] = [];
	for (let row = 1; row < lines.length; row += 1) {
		const cols = parseCsvLine(lines[row] ?? "");
		const date = cols[dateI] ?? "";
		const amountRaw = cols[amountI] ?? "0";
		if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) continue;
		const amountNum = Number(amountRaw);
		if (!Number.isFinite(amountNum) || amountNum < 0) continue;
		const amount = amountNum.toFixed(2);
		const currency = (
			(currencyI >= 0 ? cols[currencyI] : "") || defaults.currency
		).toUpperCase() as CostCurrency;
		const categoryRaw = (categoryI >= 0 ? cols[categoryI] : "other") || "other";
		const category = (
			["vps", "bandwidth", "storage", "other"].includes(categoryRaw)
				? categoryRaw
				: "other"
		) as CostCategory;
		const product = productI >= 0 ? cols[productI] || "line" : "line";
		const notes = notesI >= 0 ? cols[notesI] || undefined : undefined;
		const externalId = `csv:${date}:${product}:${amount}:${currency}`;
		items.push({
			externalId,
			category,
			providerLabel: `${defaults.providerLabel} · ${product}`,
			amount,
			currency,
			effectiveDate: date,
			notes,
			productCode: product,
		});
	}
	return items;
}

function mockItemsForProvider(
	provider: CloudBillingProvider,
	month: string,
	currency: CostCurrency,
	config: CloudBillingAccountConfig,
): CloudBillingFetchResult {
	const { start } = monthBounds(month);
	if (config.sampleCsv?.trim()) {
		return {
			items: parseBillingCsv(config.sampleCsv, {
				currency,
				providerLabel: provider.toUpperCase(),
			}).filter((i) => i.effectiveDate.startsWith(month)),
			warnings: ["Imported from sampleCsv config (probe mode)"],
		};
	}
	// Deterministic synthetic line so sync path is testable without live APIs.
	const base: CloudBillingLineItem = {
		externalId: `${provider}:mock:${month}:compute`,
		category: "vps",
		providerLabel: `${provider.toUpperCase()} · Compute`,
		amount: "12.34",
		currency,
		effectiveDate: start,
		notes: `Probe import for ${month} (${provider})`,
		productCode: "compute",
	};
	return {
		items: [base],
		warnings: [
			`Live ${provider} billing API not configured; used probe mock. Set real credentials and disable mock for production pulls.`,
		],
	};
}

async function fetchLiveItems(
	provider: CloudBillingProvider,
	_creds: CloudBillingCredentials,
	_config: CloudBillingAccountConfig,
	_month: string,
	_currency: CostCurrency,
): Promise<CloudBillingFetchResult> {
	// Real SDK integration points (not implemented in this environment):
	// - aws: Cost Explorer GetCostAndUsage / CUR Athena
	// - aliyun: BSS OpenAPI QueryBillOverview
	// - tencent: Billing DescribeBillSummaryByProduct
	// Until SDKs are wired, surface a clear error so operators never see
	// a silent "ok" with zero data when they expected live pulls.
	throw new ValidationError(
		`Live billing API for ${provider} is not enabled in this build. Provide config.sampleCsv for CSV import, or set VCONTROLHUB_CLOUD_BILLING_MOCK=1 for probe data.`,
	);
}

function isCloudBillingMockEnabled(): boolean {
	return process.env.VCONTROLHUB_CLOUD_BILLING_MOCK === "1";
}

export async function fetchCloudBillingItems(input: {
	provider: CloudBillingProvider;
	credentials: CloudBillingCredentials;
	config: CloudBillingAccountConfig;
	month: string;
	currency: CostCurrency;
}): Promise<CloudBillingFetchResult> {
	const { provider, credentials, config, month, currency } = input;
	monthBounds(month); // validate
	requireCreds(credentials, provider);

	if (provider === "generic_csv") {
		if (!config.sampleCsv?.trim()) {
			throw new ValidationError(
				"generic_csv provider requires config.sampleCsv with date,amount columns",
			);
		}
		return {
			items: parseBillingCsv(config.sampleCsv, {
				currency,
				providerLabel: "CSV",
			}).filter((i) => i.effectiveDate.startsWith(month)),
			warnings: [],
		};
	}

	if (isCloudBillingMockEnabled() || config.sampleCsv?.trim()) {
		return mockItemsForProvider(provider, month, currency, config);
	}

	return fetchLiveItems(provider, credentials, config, month, currency);
}
