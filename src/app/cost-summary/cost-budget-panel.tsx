"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormField, Notice, ProgressBar } from "@/components/ui-primitives";
import { NumberInput } from "@/components/ui/number-input";
import { EmptyState } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import type { CostBudgetRecord, CostCategory, CostCurrency } from "@/lib/cost/types";
import { CATEGORIES, inputClass } from "./cost-page-shared";
import { getErrorMessage } from "@/lib/http/error-message";
import { UI_TONE } from "@/lib/ui/classes";

export function CostBudgetPanel({
  initialBudgets,
  canManage,
  currencies,
  refreshToken = 0,
}: {
  initialBudgets: CostBudgetRecord[];
  canManage: boolean;
  currencies: CostCurrency[];
  /** Changes when the page reloads its cost data; budgets reload with it. */
  refreshToken?: number;
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
  const [creating, setCreating] = useState(false);
  // Why the budget was not created, by the button; why one was not deleted, in the dialog that asked.
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CostBudgetRecord | null>(null);
  const fieldId = useId();
  const update = (change: Partial<typeof form>) => {
    setFormError(null);
    setForm((current) => ({ ...current, ...change }));
  };

  const reload = useCallback(async () => {
    const data = (await csrfFetch("/api/cost/budgets")) as { budgets?: CostBudgetRecord[] };
    if (Array.isArray(data.budgets)) setBudgets(data.budgets);
  }, []);

  // A cost added, edited or synced elsewhere on the page changes what the
  // budgets have used; they kept showing the usage from page load.
  useEffect(() => {
    if (refreshToken === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch from the server when the page's costs change
    reload().catch(() => undefined);
  }, [refreshToken, reload]);

  const create = async () => {
    const name = form.name.trim();
    const limitAmount = form.limitAmount.trim();
    setFormError(null);
    if (!name) {
      setFormError(t("costPage.budget.error.nameRequired"));
      return;
    }
    if (!limitAmount) {
      setFormError(t("costPage.budget.error.limitRequired"));
      return;
    }
    setCreating(true);
    try {
      await csrfFetch("/api/cost/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, name, limitAmount }),
      });
      // Clear only what was saved: the fields stay editable while saving,
      // and a next budget typed meanwhile is not this one.
      setForm((current) =>
        current.name.trim() === name && current.limitAmount.trim() === limitAmount
          ? { ...current, name: "", limitAmount: "" }
          : current,
      );
      await reload();
      addToast("success", t("costPage.budget.created"));
    } catch (error) {
      setFormError(getErrorMessage(error, t("costPage.error.save")));
    } finally {
      setCreating(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await csrfFetch(`/api/cost/budgets/${pendingDelete.id}`, { method: "DELETE" });
      setPendingDelete(null);
      await reload();
      addToast("success", t("costPage.budget.deleted"));
    } catch (error) {
      setDeleteError(getErrorMessage(error, t("costPage.error.delete")));
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
        t("costPage.budget.checkDone", { count: data.result.notificationsSent }),
      );
    } catch (error) {
      addToast("error", getErrorMessage(error, t("costPage.error.load")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-card className="p-5">
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("costPage.budget.deleteTitle")}
        description={t("costPage.budget.deleteConfirm", { name: pendingDelete?.name ?? "" })}
        cancelLabel={t("costPage.budget.deleteCancel")}
        confirmLabel={t("costPage.budget.deleteConfirmBtn")}
        onCancel={() => { setPendingDelete(null); setDeleteError(null); }}
        onConfirm={() => void remove()}
        busy={busy}
        error={deleteError ?? undefined}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="ui-title-section">
            {t("costPage.budget.title")}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t("costPage.budget.desc")}</p>
        </div>
        {canManage && (
          <ActionButton
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={check}
          >
            {t("costPage.budget.check")}
          </ActionButton>
        )}
      </div>
      {canManage && (
        <form
          className="mt-4 flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_repeat(5,minmax(0,1fr))]">
            <FormField label={t("costPage.budget.name")} htmlFor={`${fieldId}-name`}>
              <input
                id={`${fieldId}-name`}
                className={inputClass}
                maxLength={128}
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </FormField>
            <FormField label={t("costPage.budget.category")} htmlFor={`${fieldId}-category`}>
              <select
                id={`${fieldId}-category`}
                className={inputClass}
                value={form.category}
                onChange={(e) => update({ category: e.target.value as CostCategory })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`costPage.category.${c}`)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t("costPage.budget.limit")} htmlFor={`${fieldId}-limit`}>
              <input
                id={`${fieldId}-limit`}
                className={`${inputClass} font-mono`}
                inputMode="decimal"
                value={form.limitAmount}
                onChange={(e) => update({ limitAmount: e.target.value })}
              />
            </FormField>
            <FormField label={t("costPage.budget.currency")} htmlFor={`${fieldId}-currency`}>
              <select
                id={`${fieldId}-currency`}
                className={inputClass}
                value={form.currency}
                onChange={(e) => update({ currency: e.target.value as CostCurrency })}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>{t(`costPage.currency.${c}`)}</option>
                ))}
              </select>
            </FormField>
            <FormField label={t("costPage.budget.period")} htmlFor={`${fieldId}-period`}>
              <select
                id={`${fieldId}-period`}
                className={inputClass}
                value={form.period}
                onChange={(e) => update({ period: e.target.value })}
              >
                <option value="monthly">{t("costPage.budget.monthly")}</option>
                <option value="quarterly">{t("costPage.budget.quarterly")}</option>
                <option value="yearly">{t("costPage.budget.yearly")}</option>
              </select>
            </FormField>
            <FormField label={t("costPage.budget.alertThreshold")} htmlFor={`${fieldId}-threshold`}>
              <NumberInput
                id={`${fieldId}-threshold`}
                min={1}
                max={100}
                integer
                className="font-mono"
                value={form.alertThresholdPercent}
                onValueChange={(alertThresholdPercent) => update({ alertThresholdPercent })}
              />
            </FormField>
          </div>
          {formError ? <Notice tone="danger">{formError}</Notice> : null}
          <div>
            <ActionButton type="submit" variant="outline" loading={creating}>
              {t("costPage.budget.create")}
            </ActionButton>
          </div>
        </form>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {budgets.length === 0 ? (
          <div className="md:col-span-2">
            <EmptyState title={t("costPage.budget.empty")} text={t("costPage.budget.emptyHint")} />
          </div>
        ) : (
          budgets.map((budget) => (
            <article key={budget.id} data-inset className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="ui-title-group">{budget.name}</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {t("costPage.budget.scope", { category: t(`costPage.category.${budget.category}`), period: t(`costPage.budget.${budget.period}`) })}
                  </p>
                </div>
                {canManage && (
                  <ActionButton size="xs" variant="danger" onClick={() => { setDeleteError(null); setPendingDelete(budget); }}>
                    {t("costPage.budget.delete")}
                  </ActionButton>
                )}
              </div>
              <ProgressBar
                label={budget.name}
                value={budget.usagePercent}
                tone={budget.usagePercent >= 100 ? "danger" : budget.usagePercent >= budget.alertThresholdPercent ? "warning" : "success"}
                className="mt-3"
              />
              <p className="mt-2 flex flex-wrap justify-between gap-x-3 text-xs text-[var(--text-secondary)]">
                <span className="font-mono">
                  {budget.usageAmount} / {budget.limitAmount} {budget.currency}
                </span>
                <span className="font-mono">{`${budget.usagePercent.toFixed(1)}%`}</span>
              </p>
              {budget.otherCurrencyUsage.length > 0 ? (
                <p className={`mt-2 rounded-lg border px-2 py-1.5 text-xs ${UI_TONE.warning}`}>
                  {t("costPage.budget.otherCurrencies", {
                    detail: budget.otherCurrencyUsage
                      .map((bucket) => `${bucket.totalAmount} ${bucket.currency} (${bucket.entryCount})`)
                      .join("、"),
                  })}
                </p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
