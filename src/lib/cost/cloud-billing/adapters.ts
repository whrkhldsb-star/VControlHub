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

import type { CostCategory, CostCurrency } from "../types";
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
    throw new ValidationError(`Invalid billing month: ${month}`);
  }
  const start = `${ys}-${ms}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${ys}-${ms}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
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

export function parseBillingCsv(
  csv: string,
  defaults: {
    currency: CostCurrency;
    providerLabel: string;
    categoryMap?: Record<string, CostCategory>;
  },
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
    const product = productI >= 0 ? cols[productI] || "line" : "line";
    const category = resolveBillingCategory(
      categoryRaw,
      product,
      defaults.categoryMap,
    );
    const notes = notesI >= 0 ? cols[notesI] || undefined : undefined;
    const explicitExternalId =
      externalIdI >= 0 ? cols[externalIdI]?.trim() : "";
    const rowHash = createHash("sha256")
      .update(JSON.stringify(cols))
      .digest("hex")
      .slice(0, 24);
    const duplicateOrdinal = (duplicateCounts.get(rowHash) ?? 0) + 1;
    duplicateCounts.set(rowHash, duplicateOrdinal);
    const externalId = explicitExternalId
      ? `csv:id:${explicitExternalId}`
      : `csv:row:${rowHash}:${duplicateOrdinal}`;
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
        categoryMap: config.categoryMap,
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
        `billingCsvUrl host is not allowed (SSRF protection): ${error.message}`,
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
    const res = await fetch(safeUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "text/csv,text/plain,*/*" },
    });
    if (!res.ok) {
      throw new ValidationError(`billingCsvUrl HTTP ${res.status}`);
    }
    const text = await res.text();
    if (text.length > 2_000_000) {
      throw new ValidationError(
        t("backend.cost.billingcsvurlResponseTooLarge"),
      );
    }
    return {
      items: parseBillingCsv(text, {
        currency,
        providerLabel: provider.toUpperCase(),
        categoryMap,
      }).filter((i) => i.effectiveDate.startsWith(month)),
      warnings: [`Imported from billingCsvUrl (${provider})`],
    };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`Failed to fetch billingCsvUrl: ${msg}`);
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
    `${provider} billing import requires config.billingCsvUrl or config.sampleCsv with date,amount columns.`,
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
      return {
        items: parseBillingCsv(config.sampleCsv, {
          currency,
          providerLabel:
            provider === "generic_csv" ? "CSV" : provider.toUpperCase(),
          categoryMap: config.categoryMap,
        }).filter((i) => i.effectiveDate.startsWith(month)),
        warnings: [],
      };
    }
    return fetchLiveItems(provider, credentials, config, month, currency);
  }

  return mockItemsForProvider(provider, month, currency, config);
}
