"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge, FormField, Notice, ProgressBar } from "@/components/ui-primitives";
import { NumberInput } from "@/components/ui/number-input";
import { EmptyState } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";
import type { CostBudgetRecord, CostCategory, CostCurrency } from "@/lib/cost/types";
import { CATEGORIES, inputClass } from "./cost-page-shared";
import { getErrorMessage } from "@/lib/http/error-message";
import { UI_TONE } from "@/lib/ui/classes";

/** A budget as its form holds it. */
export type BudgetFormValues = {
  name: string;
  category: CostCategory;
  limitAmount: string;
  currency: CostCurrency;
  period: string;
  alertThresholdPercent: number;
};

const BLANK_FORM: BudgetFormValues = {
  name: "",
  category: "vps",
  limitAmount: "",
  currency: "CNY",
  period: "monthly",
  alertThresholdPercent: 80,
};

function formOf(budget: CostBudgetRecord): BudgetFormValues {
  return {
    name: budget.name,
    category: budget.category,
    limitAmount: budget.limitAmount,
    currency: budget.currency,
    period: budget.period,
    alertThresholdPercent: budget.alertThresholdPercent,
  };
}

/** The fields of an edited budget that differ from the saved one: what the edit sends. */
export function changedBudgetFields(saved: CostBudgetRecord, next: BudgetFormValues): Partial<BudgetFormValues> {
  const changes: Partial<BudgetFormValues> = {};
  if (next.name.trim() !== saved.name) changes.name = next.name.trim();
  if (next.category !== saved.category) changes.category = next.category;
  // "100" and "100.00" are the same limit.
  if (Number(next.limitAmount.trim()) !== Number(saved.limitAmount)) changes.limitAmount = next.limitAmount.trim();
  if (next.currency !== saved.currency) changes.currency = next.currency;
  if (next.period !== saved.period) changes.period = next.period;
  if (next.alertThresholdPercent !== saved.alertThresholdPercent) changes.alertThresholdPercent = next.alertThresholdPercent;
  return changes;
}

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
  const [form, setForm] = useState<BudgetFormValues>(BLANK_FORM);
  // The budget whose changes the form holds; null while it makes a new one. A budget could not be changed once
  // created: a new limit meant deleting it and making it again.
  const [editing, setEditing] = useState<CostBudgetRecord | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Why the budget was not saved, by the button; why one was not deleted, in the dialog that asked.
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CostBudgetRecord | null>(null);
  const fieldId = useId();
  const update = (change: Partial<BudgetFormValues>) => {
    setFormError(null);
    setForm((current) => ({ ...current, ...change }));
  };

  const closeEdit = () => {
    setEditing(null);
    setForm(BLANK_FORM);
    setFormError(null);
  };
  const dirty = editing !== null && Object.keys(changedBudgetFields(editing, form)).length > 0;
  const { requestDiscard, discardDialog } = useUnsavedChangesGuard({ dirty, onDiscard: closeEdit });

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

  const startEdit = (budget: CostBudgetRecord) => {
    setEditing(budget);
    setForm(formOf(budget));
    setFormError(null);
    formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  const submit = async () => {
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
    if (editing) {
      // An edit sends what changed, and nothing when nothing did.
      const changes = changedBudgetFields(editing, form);
      if (Object.keys(changes).length === 0) {
        addToast("info", t("costPage.unchanged"));
        closeEdit();
        return;
      }
      setSubmitting(true);
      try {
        await csrfFetch(`/api/cost/budgets/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        });
        closeEdit();
        await reload();
        addToast("success", t("costPage.budget.updated", { name }));
      } catch (error) {
        setFormError(getErrorMessage(error, t("costPage.error.save")));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setSubmitting(true);
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
      setSubmitting(false);
    }
  };

  // A budget's switch decides whether it alerts; the API took it, the page had no way to set it.
  const toggle = async (budget: CostBudgetRecord) => {
    setTogglingId(budget.id);
    try {
      await csrfFetch(`/api/cost/budgets/${budget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !budget.enabled }),
      });
      await reload();
      addToast("success", t(budget.enabled ? "costPage.budget.alertsOff" : "costPage.budget.alertsOn", { name: budget.name }));
    } catch (error) {
      addToast("error", getErrorMessage(error, t("costPage.error.save")));
    } finally {
      setTogglingId(null);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await csrfFetch(`/api/cost/budgets/${pendingDelete.id}`, { method: "DELETE" });
      if (editing?.id === pendingDelete.id) closeEdit();
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
          ref={formRef}
          className="mt-4 flex scroll-mt-24 flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {editing ? <h3 className="ui-title-group">{t("costPage.budget.editTitle", { name: editing.name })}</h3> : null}
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
          <div className="flex flex-wrap gap-2">
            <ActionButton type="submit" variant={editing ? "primary" : "outline"} loading={submitting}>
              {editing ? t("costPage.saveChanges") : t("costPage.budget.create")}
            </ActionButton>
            {editing ? (
              <ActionButton type="button" variant="secondary" onClick={requestDiscard}>
                {t("costPage.cancelEdit")}
              </ActionButton>
            ) : null}
          </div>
          {discardDialog}
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
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="ui-title-group">{budget.name}</h3>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                    {t("costPage.budget.scope", { category: t(`costPage.category.${budget.category}`), period: t(`costPage.budget.${budget.period}`) })}
                    {budget.enabled ? null : <Badge>{t("costPage.budget.alertsOffBadge")}</Badge>}
                  </p>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <ActionButton size="xs" variant="outline"
                      onClick={() => startEdit(budget)}
                      disabled={editing !== null}
                      title={editing !== null ? t("costPage.editBusy") : undefined}>
                      {t("costPage.edit")}
                    </ActionButton>
                    <ActionButton size="xs" variant="secondary"
                      onClick={() => void toggle(budget)}
                      loading={togglingId === budget.id}
                      disabled={togglingId !== null}>
                      {budget.enabled ? t("costPage.budget.turnAlertsOff") : t("costPage.budget.turnAlertsOn")}
                    </ActionButton>
                    <ActionButton size="xs" variant="danger" onClick={() => { setDeleteError(null); setPendingDelete(budget); }}>
                      {t("costPage.budget.delete")}
                    </ActionButton>
                  </div>
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
                    // Each amount says what its number in brackets counts; "、" read as a stray mark in English.
                    detail: budget.otherCurrencyUsage
                      .map((bucket) => t("costPage.budget.otherCurrencyBucket", { amount: bucket.totalAmount, currency: bucket.currency, count: bucket.entryCount }))
                      .join(t("common.listSeparator")),
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
