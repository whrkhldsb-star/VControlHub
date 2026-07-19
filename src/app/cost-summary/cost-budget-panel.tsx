"use client";

import { useState } from "react";
import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import type { CostBudgetRecord, CostCategory, CostCurrency } from "@/lib/cost/types";
import { CATEGORIES, cardClass, inputClass } from "./cost-page-shared";

export function CostBudgetPanel({
  initialBudgets,
  canManage,
  currencies,
}: {
  initialBudgets: CostBudgetRecord[];
  canManage: boolean;
  currencies: CostCurrency[];
}) {
  const { t } = useI18n();
  const { addToast } = useToast();
  const [budgets, setBudgets] = useState(initialBudgets);
  const [form, setForm] = useState({
    name: "",
    category: "vps" as CostCategory,
    limitAmount: "",
    currency: "CNY" as CostCurrency,
    period: "monthly",
    alertThresholdPercent: 80,
  });
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CostBudgetRecord | null>(null);

  const reload = async () => {
    const data = (await csrfFetch("/api/cost/budgets")) as { budgets?: CostBudgetRecord[] };
    if (Array.isArray(data.budgets)) setBudgets(data.budgets);
  };

  const create = async () => {
    if (!form.name.trim() || !form.limitAmount.trim()) return;
    setBusy(true);
    try {
      await csrfFetch("/api/cost/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          limitAmount: form.limitAmount.trim(),
        }),
      });
      setForm((current) => ({ ...current, name: "", limitAmount: "" }));
      await reload();
      addToast("success", t("costPage.budget.created"));
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : t("costPage.error.save"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await csrfFetch(`/api/cost/budgets/${pendingDelete.id}`, { method: "DELETE" });
      setPendingDelete(null);
      await reload();
      addToast("success", t("costPage.budget.deleted"));
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : t("costPage.error.delete"));
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    try {
      const data = (await csrfFetch("/api/cost/budgets/check", { method: "POST" })) as {
        result: { notificationsSent: number };
      };
      await reload();
      addToast(
        "success",
        t("costPage.budget.checkDone").replace("{count}", String(data.result.notificationsSent)),
      );
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : t("costPage.error.load"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cardClass}>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("costPage.budget.deleteTitle")}
        description={t("costPage.budget.deleteConfirm").replace(
          "{name}",
          pendingDelete?.name ?? "",
        )}
        cancelLabel={t("costPage.budget.deleteCancel")}
        confirmLabel={t("costPage.budget.deleteConfirmBtn")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
        busy={busy}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {t("costPage.budget.title")}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t("costPage.budget.desc")}</p>
        </div>
        {canManage && (
          <button
            type="button"
            disabled={busy}
            onClick={check}
            className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs"
          >
            {t("costPage.budget.check")}
          </button>
        )}
      </div>
      {canManage && (
        <div className="mt-4 grid gap-2 md:grid-cols-6">
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t("costPage.budget.name")}
          />
          <select
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
          <input
            className={inputClass}
            value={form.limitAmount}
            onChange={(e) => setForm({ ...form, limitAmount: e.target.value })}
            placeholder={t("costPage.budget.limit")}
          />
          <select
            className={inputClass}
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value as CostCurrency })}
          >
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            className={inputClass}
            value={form.period}
            onChange={(e) => setForm({ ...form, period: e.target.value })}
          >
            <option value="monthly">{t("costPage.budget.monthly")}</option>
            <option value="quarterly">{t("costPage.budget.quarterly")}</option>
            <option value="yearly">{t("costPage.budget.yearly")}</option>
          </select>
          <ActionButton type="button" disabled={busy} onClick={create} className="px-3 py-2 text-sm">
            {t("costPage.budget.create")}
          </ActionButton>
        </div>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {budgets.length === 0 ? (
          <div className="space-y-1 md:col-span-2">
            <p className="text-sm text-[var(--text-muted)]">{t("costPage.budget.empty")}</p>
            <p className="text-xs text-[var(--text-muted)]">{t("costPage.budget.emptyHint")}</p>
          </div>
        ) : (
          budgets.map((budget) => (
            <article key={budget.id} className="rounded-2xl border border-[var(--border)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{budget.name}</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {t(`costPage.category.${budget.category}`)} ·{" "}
                    {t(`costPage.budget.${budget.period}`)}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setPendingDelete(budget)}
                    className="text-xs text-[var(--danger)]"
                  >
                    {t("costPage.budget.delete")}
                  </button>
                )}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                <div
                  className={`h-full ${
                    budget.usagePercent >= 100
                      ? "bg-[var(--danger)]"
                      : budget.usagePercent >= budget.alertThresholdPercent
                        ? "bg-[var(--warning)]"
                        : "bg-[var(--success)]"
                  }`}
                  style={{ width: `${Math.min(100, budget.usagePercent)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                <span>
                  {budget.usageAmount} / {budget.limitAmount} {budget.currency}
                </span>
                <span className="ml-1">·</span>
                <span className="ml-1">{`${budget.usagePercent.toFixed(1)}%`}</span>
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
