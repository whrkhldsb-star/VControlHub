"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { costAmountSchema } from "@/lib/cost/schema";
import { toDateLocale } from "@/lib/i18n/locale-format";
import type {
  CostCurrency,
  CostEntryRecord,
  CostSummary,
  DailySnapshot,
} from "@/lib/cost/types";

import { emptyForm, formatAmount, isValidDate } from "./cost-page-shared";

type ToastFn = (type: "success" | "error" | "info" | "warning", message: string) => void;
type TFn = (key: string) => string;

export function useCostPageState(options: {
  initialMonth: string;
  initialCurrency: CostCurrency;
  initialSummary: CostSummary | null;
  initialEntries: CostEntryRecord[];
  initialSnapshots: DailySnapshot[];
  canManage: boolean;
  t: TFn;
  locale: "zh" | "en";
  addToast: ToastFn;
}) {
  const {
    initialMonth,
    initialCurrency,
    initialSummary,
    initialEntries,
    initialSnapshots,
    canManage,
    t,
    locale,
    addToast,
  } = options;

  const [month, setMonth] = useState(initialMonth);
  const [currency, setCurrency] = useState<CostCurrency>(initialCurrency);
  const [summary, setSummary] = useState<CostSummary | null>(initialSummary);
  const [entries, setEntries] = useState<CostEntryRecord[]>(initialEntries);
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>(initialSnapshots);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [syncingSources, setSyncingSources] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    provider: string;
    amount: string;
  } | null>(null);

  const localeTag = toDateLocale(locale);
  const summaryReqSeq = useRef(0);
  const entriesReqSeq = useRef(0);
  const snapshotsReqSeq = useRef(0);

  const fetchSummary = useCallback(
    async (m: string, c: CostCurrency) => {
      const seq = ++summaryReqSeq.current;
      try {
        const res = await csrfFetch<Response>(`/api/cost/summary?month=${m}&currency=${c}`, {
          raw: true,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { summary: CostSummary };
        if (seq !== summaryReqSeq.current) return;
        setSummary(data.summary);
      } catch (err) {
        if (seq !== summaryReqSeq.current) return;
        addToast(
          "error",
          `${t("costPage.error.load")}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [addToast, t],
  );

  const fetchEntries = useCallback(async (forMonth?: string) => {
    const seq = ++entriesReqSeq.current;
    try {
      const m = forMonth ?? month;
      const qs = new URLSearchParams({ limit: "200" });
      if (m) qs.set("month", m);
      const res = await csrfFetch<Response>(`/api/cost/entries?${qs.toString()}`, { raw: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: CostEntryRecord[] };
      if (seq !== entriesReqSeq.current) return;
      setEntries(data.entries);
    } catch (err) {
      if (seq !== entriesReqSeq.current) return;
      addToast(
        "error",
        `${t("costPage.error.load")}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [addToast, t, month]);

  const fetchSnapshots = useCallback(async (forCurrency?: CostCurrency) => {
    const seq = ++snapshotsReqSeq.current;
    const c = forCurrency ?? currency;
    try {
      const qs = new URLSearchParams({ limit: "30", currency: c });
      const res = await csrfFetch<Response>(`/api/cost/snapshots?${qs.toString()}`, { raw: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { snapshots: DailySnapshot[] };
      if (seq !== snapshotsReqSeq.current) return;
      setSnapshots(data.snapshots);
    } catch (err) {
      if (seq !== snapshotsReqSeq.current) return;
      // Snapshots power the trend chart only; keep the rest of the page usable
      // but surface the failure so operators are not left with a silent empty chart.
      addToast(
        "error",
        `${t("costPage.error.loadSnapshots")}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [addToast, t, currency]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchSummary(month, currency), fetchEntries(), fetchSnapshots(currency)]);
  }, [fetchSummary, fetchEntries, fetchSnapshots, month, currency]);

  const syncServerCosts = useCallback(async () => {
    if (!canManage) return;
    setSyncingSources(true);
    try {
      const res = await csrfFetch<Response>("/api/cost/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month }),
        raw: true,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { result: { synced: number; skipped: number } };
      addToast(
        "success",
        t("costPage.actions.syncSourcesDone")
          .replace("{synced}", String(data.result.synced))
          .replace("{skipped}", String(data.result.skipped)),
      );
      await refreshAll();
    } catch (err) {
      addToast(
        "error",
        `${t("costPage.actions.syncSourcesError")}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSyncingSources(false);
    }
  }, [addToast, canManage, month, refreshAll, t]);

  const onChangeMonth = useCallback(
    async (m: string) => {
      setMonth(m);
      await Promise.all([fetchSummary(m, currency), fetchEntries(m)]);
    },
    [currency, fetchSummary, fetchEntries],
  );

  const onChangeCurrency = useCallback(
    async (c: CostCurrency) => {
      setCurrency(c);
      await Promise.all([fetchSummary(month, c), fetchSnapshots(c)]);
    },
    [month, fetchSummary, fetchSnapshots],
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (e: CostEntryRecord) => {
    setEditingId(e.id);
    setForm({
      category: e.category,
      provider: e.provider,
      amount: e.amount,
      currency: e.currency,
      effectiveDate: e.effectiveDate,
      notes: e.notes ?? "",
    });
    setShowForm(true);
  };

  const submitForm = async () => {
    if (!canManage) return;
    if (!form.provider.trim() || !form.amount.trim() || !isValidDate(form.effectiveDate)) {
      addToast("error", t("costPage.form.error.required"));
      return;
    }
    const amountCheck = costAmountSchema.safeParse(form.amount.trim());
    if (!amountCheck.success) {
      addToast(
        "error",
        amountCheck.error.issues[0]?.message ?? t("costPage.form.error.required"),
      );
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category: form.category,
        provider: form.provider.trim(),
        amount: form.amount.trim(),
        currency: form.currency,
        effectiveDate: form.effectiveDate,
        notes: form.notes.trim() || null,
      };
      const url = editingId ? `/api/cost/entries/${editingId}` : "/api/cost/entries";
      const method = editingId ? "PATCH" : "POST";
      const res = await csrfFetch<Response>(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        raw: true,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      setShowForm(false);
      setEditingId(null);
      addToast("success", t("costPage.form.submit"));
      await refreshAll();
    } catch (err) {
      addToast(
        "error",
        `${t("costPage.error.save")}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    try {
      const res = await csrfFetch<Response>(`/api/cost/entries/${confirmDelete.id}`, {
        method: "DELETE",
        raw: true,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmDelete(null);
      addToast("success", t("costPage.delete.confirmBtn"));
      await refreshAll();
    } catch (err) {
      addToast(
        "error",
        `${t("costPage.error.delete")}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setDeletingId(null);
    }
  };

  const requestDelete = (e: CostEntryRecord) => {
    setConfirmDelete({
      id: e.id,
      provider: e.provider,
      amount: formatAmount(e.amount, e.currency, localeTag),
    });
  };

  const trend = useMemo(() => {
    return [...snapshots]
      .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
      .slice(-14)
      .map((s) => ({
        date: s.snapshotDate.slice(5),
        total: Number(s.totalAmount),
      }));
  }, [snapshots]);

  return {
    month,
    currency,
    summary,
    entries,
    showForm,
    editingId,
    form,
    saving,
    syncingSources,
    deletingId,
    confirmDelete,
    localeTag,
    trend,
    setForm,
    setShowForm,
    setEditingId,
    setConfirmDelete,
    refreshAll,
    syncServerCosts,
    onChangeMonth,
    onChangeCurrency,
    openCreate,
    openEdit,
    submitForm,
    onConfirmDelete,
    requestDelete,
  };
}
