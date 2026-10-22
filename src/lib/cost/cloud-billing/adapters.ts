import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Cloud billing adapters (FEAT-COST-CLOUD-BILLING).
 *
 * Production design:
 * - Real AWS Cost Explorer / CUR, Aliyun BSS, Tencent Billing APIs require
 *   vendor SDKs and network egress. This module provides:
 *   1) Month and CSV export validation for all providers
 *   2) A deterministic "probe" mode when `config.sampleCsv` is set or
 *      `VCONTROLHUB_CLOUD_BILLING_MOCK=1` — used in tests and air-gapped hosts
 *   3) HTTP-ready structure so real SDK calls can replace `fetchLiveItems`
 *      without changing CostEntry upsert semantics
 *
 * Failure modes (never fake success):
 * - Missing CSV payload/export URL → ValidationError
 * - Adapter throw → sync run status=error with errorMessage
 * - Empty month → ok with imported=0 (legitimate empty bill)
 */
import { createHash } from "node:crypto";

import { ValidationError } from "@/lib/errors";
import {
  assertPublicBaseUrlResolvesPublic,
  isUnsafePublicHttpHost,
  normalizePublicHttpUrl,
} from "@/lib/storage/direct-access-url";
import { fetchWithPinnedDns } from "@/lib/security/pinned-fetch";
import {
  readResponseTextLimited,
  ResponseBodyTooLargeError,
} from "@/lib/http/response-body";

import type { CostCategory, CostCurrency } from "../types";
import { COST_CURRENCY_VALUES } from "../types";
import { config } from "@/lib/config/env";
import { t } from "@/lib/i18n/service-translations";
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
    throw new ValidationError(apiCopy("apiCopy.invalid.billing.month.677bfd1d", { v0: String(month) }));
  }
  const start = `${ys}-${ms}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${ys}-${ms}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

/**
 * Split CSV text into records. A quoted field may hold commas, doubled
 * quotes and line breaks (RFC 4180); splitting on newlines first cut such a
 * record in two, so the columns after a multi-line note fell back to their
 * defaults (an EUR charge was booked as USD, "other").
 */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cur = "";
  let inQuotes = false;
  const endRecord = () => {
    record.push(cur.trim());
    cur = "";
    if (record.some((field) => field !== "")) records.push(record);
    record = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === ",") {
      record.push(cur.trim());
      cur = "";
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRecord();
      continue;
    }
    cur += ch;
  }
  if (inQuotes) {
    throw new ValidationError(t("backend.cost.csvUnterminatedQuote"));
  }
  if (cur !== "" || record.length > 0) endRecord();
  return records;
}

/**
 * Largest amount the cost tables hold: amount and limit columns are
 * Decimal(12,2). A larger value passed validation and failed in the database.
 */
export const MAX_COST_AMOUNT = 9_999_999_999.99;

/**
 * CSV columns (header required):
 * date,amount,currency,category,product,notes
 */
const COST_CATEGORIES = new Set<CostCategory>([
  "vps",
  "bandwidth",
  "storage",
  "other",
]);

function resolveBillingCategory(
  categoryRaw: string,
  product: string,
  categoryMap?: Record<string, CostCategory>,
): CostCategory {
  const mappedProduct = categoryMap?.[product];
  if (mappedProduct && COST_CATEGORIES.has(mappedProduct)) return mappedProduct;
  const mappedCategory = categoryMap?.[categoryRaw];
  if (mappedCategory && COST_CATEGORIES.has(mappedCategory))
    return mappedCategory;
  if (COST_CATEGORIES.has(categoryRaw as CostCategory))
    return categoryRaw as CostCategory;
  return "other";
}

type BillingCsvDefaults = {
  currency: CostCurrency;
  providerLabel: string;
  categoryMap?: Record<string, CostCategory>;
};

export function parseBillingCsv(csv: string, defaults: BillingCsvDefaults): CloudBillingLineItem[] {
  return parseBillingCsvRows(csv, defaults).items;
}

/** A data row the parser could not read; `row` is its 1-based record number after the header. */
export interface RejectedBillingCsvRow {
  row: number;
  reason: "date" | "amount";
  value: string;
}

/**
 * Parse a billing CSV, keeping the rows it could not read. Dropping them
 * silently reported "imported 1, skipped 0" for a file of two charges.
 */
export function parseBillingCsvRows(
  csv: string,
  defaults: BillingCsvDefaults,
): { items: CloudBillingLineItem[]; rejected: RejectedBillingCsvRow[] } {
  const records = parseCsvRecords(csv);
  const rejected: RejectedBillingCsvRow[] = [];
  if (records.length < 2) return { items: [], rejected };
  const header = (records[0] ?? []).map((h) => h.toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const dateI = idx("date");
  const amountI = idx("amount");
  if (dateI < 0 || amountI < 0) {
    throw new ValidationError(
      t("backend.cost.csvMustIncludeDateAndAmountColumns"),
    );
  }
  const currencyI = idx("currency");
  const categoryI = idx("category");
  const productI = idx("product");
  const notesI = idx("notes");
  const externalIdI = Math.max(idx("external_id"), idx("id"));
  const duplicateCounts = new Map<string, number>();
  const items: CloudBillingLineItem[] = [];
  for (let row = 1; row < records.length; row += 1) {
    const cols = records[row] ?? [];
    const date = cols[dateI] ?? "";
    const amountRaw = cols[amountI] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
      rejected.push({ row, reason: "date", value: date.slice(0, 40) });
      continue;
    }
    const amountNum = amountRaw.trim() === "" ? Number.NaN : Number(amountRaw);
    // Mirror the manual entry cap (costAmountSchema). An absurd/overflowing
    // CSV amount is a malformed row, not a charge: it would poison
    // per-currency totals, or fail in the database.
    if (!Number.isFinite(amountNum) || amountNum < 0 || amountNum > MAX_COST_AMOUNT) {
      rejected.push({ row, reason: "amount", value: amountRaw.slice(0, 40) });
      continue;
    }
    const amount = amountNum.toFixed(2);
    // The manual path validates currency against COST_CURRENCY_VALUES
    // (costCurrencySchema). The CSV path must too: an out-of-enum token
    // previously got cast straight to CostCurrency and persisted, so that spend
    // silently dropped out of every per-currency summary and budget check. Fail
    // loud on an explicit unsupported currency; fall back to the account
    // default only when the column is absent/empty.
    const currencyToken = (
      currencyI >= 0 ? (cols[currencyI] ?? "").trim() : ""
    ).toUpperCase();
    let currency: CostCurrency;
    if (!currencyToken) {
      currency = defaults.currency;
    } else if (
      (COST_CURRENCY_VALUES as readonly string[]).includes(currencyToken)
    ) {
      currency = currencyToken as CostCurrency;
    } else {
      throw new ValidationError(
        t("backend.cost.csvUnsupportedCurrency", { currency: currencyToken }),
      );
    }
    const categoryRaw = (categoryI >= 0 ? cols[categoryI] : "other") || "other";
    const product = productI >= 0 ? cols[productI] || "line" : "line";
    const category = resolveBillingCategory(
      categoryRaw,
      product,
      defaults.categoryMap,
    );
    const notes = notesI >= 0 ? cols[notesI] || undefined : undefined;
    const explicitExternalId =
      externalIdI >= 0 ? cols[externalIdI]?.trim() : "";
    // A provider correction commonly changes amount/category/notes. Keep the
    // fallback identity stable across those edits while preserving repeated
    // charges for the same product and day through a deterministic ordinal.
    const naturalKeyHash = createHash("sha256")
      .update(JSON.stringify([date, product]))
      .digest("hex")
      .slice(0, 24);
    const duplicateOrdinal = (duplicateCounts.get(naturalKeyHash) ?? 0) + 1;
    duplicateCounts.set(naturalKeyHash, duplicateOrdinal);
    const externalId = explicitExternalId
      ? `csv:id:${explicitExternalId}`
      : `csv:natural:${naturalKeyHash}:${duplicateOrdinal}`;
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
  return { items, rejected };
}

/** The fetch result for a CSV: in-month items, plus a warning per unreadable row. */
function billingCsvFetchResult(
  csv: string,
  defaults: BillingCsvDefaults,
  month: string,
  warnings: string[],
): CloudBillingFetchResult {
  const { items, rejected } = parseBillingCsvRows(csv, defaults);
  return {
    items: items.filter((i) => i.effectiveDate.startsWith(month)),
    warnings: [
      ...warnings,
      ...rejected.slice(0, 20).map((r) =>
        t(r.reason === "date" ? "backend.cost.csvRowInvalidDate" : "backend.cost.csvRowInvalidAmount", { row: String(r.row), value: r.value }),
      ),
    ],
    rejectedRows: rejected.length,
  };
}

function mockItemsForProvider(
  provider: CloudBillingProvider,
  month: string,
  currency: CostCurrency,
  config: CloudBillingAccountConfig,
): CloudBillingFetchResult {
  const { start } = monthBounds(month);
  if (config.sampleCsv?.trim()) {
    return billingCsvFetchResult(
      config.sampleCsv,
      { currency, providerLabel: provider.toUpperCase(), categoryMap: config.categoryMap },
      month,
      ["Imported from sampleCsv config (probe mode)"],
    );
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
      `Used deterministic ${provider} probe data because VCONTROLHUB_CLOUD_BILLING_MOCK is enabled.`,
    ],
  };
}

async function fetchBillingCsvFromUrl(
  url: string,
  provider: CloudBillingProvider,
  month: string,
  currency: CostCurrency,
  categoryMap?: Record<string, CostCategory>,
): Promise<CloudBillingFetchResult> {
  // Re-validate stored URL at fetch time (legacy rows / DB drift) + DNS rebind check.
  let safeUrl: string;
  try {
    safeUrl = normalizePublicHttpUrl(
      url,
      "billingCsvUrl must be a public http(s) URL without credentials",
    );
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(
      error instanceof Error
        ? error.message
        : "billingCsvUrl is not a valid public URL",
    );
  }

  // Resolve hostname immediately before request to reduce DNS rebinding risk.
  // assertPublicBaseUrlResolvesPublic strips path/query; we only need the host check.
  const hostForDns = new URL(safeUrl).origin;
  try {
    await assertPublicBaseUrlResolvesPublic(hostForDns);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new ValidationError(
        apiCopy("apiCopy.billingcsvurl.host.is.not.allowed.ssrf.protection.e392d2ad", { v0: String(error.message) }),
      );
    }
    throw error;
  }

  const parsed = new URL(safeUrl);
  if (isUnsafePublicHttpHost(parsed.hostname)) {
    throw new ValidationError(
      t("backend.cost.billingcsvurlHostIsNotAllowedSsrfProtection"),
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    // Pinned dispatch: connect to the address the public-resolution check
    // above verified, not whatever DNS answers on a second lookup (rebind).
    const res = await fetchWithPinnedDns(safeUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "text/csv,text/plain,*/*" },
    });
    if (!res.ok) {
      throw new ValidationError(apiCopy("apiCopy.billingcsvurl.http.1960beef", { v0: String(res.status) }));
    }
    let text: string;
    try {
      text = await readResponseTextLimited(res, 2_000_000);
    } catch (error) {
      if (error instanceof ResponseBodyTooLargeError) {
        throw new ValidationError(t("backend.cost.billingcsvurlResponseTooLarge"));
      }
      throw error;
    }
    return billingCsvFetchResult(
      text,
      { currency, providerLabel: provider.toUpperCase(), categoryMap },
      month,
      [`Imported from billingCsvUrl (${provider})`],
    );
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new ValidationError(apiCopy("apiCopy.failed.to.fetch.billingcsvurl.394a2afb", { v0: String(msg) }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLiveItems(
  provider: CloudBillingProvider,
  _creds: CloudBillingCredentials,
  config: CloudBillingAccountConfig,
  month: string,
  currency: CostCurrency,
): Promise<CloudBillingFetchResult> {
  // Provider-tagged imports use a vendor CSV export URL. Native vendor APIs
  // are intentionally not advertised until their adapters are implemented.
  if (config.billingCsvUrl?.trim()) {
    return fetchBillingCsvFromUrl(
      config.billingCsvUrl.trim(),
      provider,
      month,
      currency,
      config.categoryMap,
    );
  }
  throw new ValidationError(
    apiCopy("apiCopy.billing.import.requires.config.billingcsvurl.or.config.samplecsv.596def5b", { v0: String(provider) }),
  );
}

function isCloudBillingMockEnabled(): boolean {
  return config.cost.cloudBillingMock;
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
  if (provider === "generic_csv" || !isCloudBillingMockEnabled()) {
    // All production providers currently consume explicit CSV exports. Provider
    // selection labels the imported rows; it does not imply a native SDK call.
    if (config.billingCsvUrl?.trim()) {
      return fetchBillingCsvFromUrl(
        config.billingCsvUrl.trim(),
        provider,
        month,
        currency,
        config.categoryMap,
      );
    }
    if (config.sampleCsv?.trim()) {
      return billingCsvFetchResult(
        config.sampleCsv,
        {
          currency,
          providerLabel: provider === "generic_csv" ? "CSV" : provider.toUpperCase(),
          categoryMap: config.categoryMap,
        },
        month,
        [],
      );
    }
    return fetchLiveItems(provider, credentials, config, month, currency);
  }

  return mockItemsForProvider(provider, month, currency, config);
}
