"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

/** Billing section shared by the Linux and Windows create forms (same advanced-details pattern). */
export function ServerCostFields() {
  const { t } = useI18n();
  return (
    <details className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
      <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">
        {t("serversPage.create.costAdvancedTitle")}
      </summary>
      <div className="mt-4 space-y-3">
        <label className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
          <input
            name="costAutoSync"
            type="checkbox"
            className="mt-1 h-4 w-4 rounded-lg border-[var(--border)] bg-[var(--input-bg)]"
          />
          <span>
            <span className="block font-medium text-[var(--text-primary)]">
              {t("serversPage.create.costAutoSync")}
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {t("serversPage.create.costHint")}
            </span>
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--text-primary)]/70" htmlFor="serverCostMonthlyAmount">
              {t("serversPage.create.costMonthlyAmount")}
            </label>
            <input
              id="serverCostMonthlyAmount"
              name="costMonthlyAmount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              className={UI_INPUT}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--text-primary)]/70" htmlFor="serverCostCurrency">
              {t("serversPage.create.costCurrency")}
            </label>
            <select
              id="serverCostCurrency"
              name="costCurrency"
              defaultValue="CNY"
              className={UI_INPUT}
            >
              {(["CNY", "USD", "EUR", "JPY", "HKD"] as const).map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--text-primary)]/70" htmlFor="serverCostProvider">
            {t("serversPage.create.costProvider")}
          </label>
          <input
            id="serverCostProvider"
            name="costProvider"
            type="text"
            placeholder={t("serversPage.create.costProviderPlaceholder")}
            className={UI_INPUT}
          />
        </div>
      </div>
    </details>
  );
}
