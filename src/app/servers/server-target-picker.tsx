"use client";

import { useEffect, useId, useState } from "react";
import { ActionButton } from "@/components/action-button";
import { EmptyState } from "@/components/page-shell";
import { InlineLoading } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { loadServerOperationTargets } from "./inventory-actions";

type Result = Awaited<ReturnType<typeof loadServerOperationTargets>>;
export type ServerTarget = Result["rows"][number];

/** Keeps only the visible slice and explicitly selected rows in the browser. */
export function ServerTargetPicker({ kind, selected, onChange, onEnabledCount }: {
  kind: "command" | "batch";
  selected: ServerTarget[];
  onChange: (rows: ServerTarget[]) => void;
  onEnabledCount?: (count: number) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [draft, setDraft] = useState("");
  const [request, setRequest] = useState({ query: "", page: 1, attempt: 0 });
  const key = JSON.stringify([kind, request]);
  const [state, setState] = useState<{ key: string; data?: Result; error?: boolean }>({ key: "" });
  useEffect(() => {
    let active = true;
    loadServerOperationTargets(kind, { query: request.query, page: request.page }).then((data) => {
      if (!active) return;
      setState({ key, data });
      onEnabledCount?.(data.enabledCount);
    }, () => { if (active) setState({ key, error: true }); });
    return () => { active = false; };
  }, [kind, key, request.query, request.page, onEnabledCount]);
  const pending = state.key !== key;
  const data = state.data;
  const rows = pending ? [] : data?.rows ?? [];
  const ids = new Set(selected.map((row) => row.id));
  const selectable = rows.filter((row) => kind === "batch" || row.available);
  const allPageSelected = selectable.length > 0 && selectable.every((row) => ids.has(row.id));
  const search = () => setRequest({ query: draft.trim(), page: 1, attempt: request.attempt + 1 });
  return <section aria-label={t("serversPage.command.targetNodes")} aria-busy={pending} className="space-y-3 min-w-0">
    <label htmlFor={id} className="block text-sm font-medium">{t("serversPage.inventory.search")}</label>
    <div className="flex gap-2">
      <input id={id} type="search" maxLength={200} className={UI_INPUT} value={draft}
        onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); search(); }
        }} />
      <ActionButton variant="secondary" onClick={search}>{t("serversPage.targets.search")}</ActionButton>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
      <ActionButton variant="secondary" disabled={pending || !selectable.length} aria-pressed={allPageSelected}
        onClick={() => {
          const next = new Map(selected.map((row) => [row.id, row]));
          for (const row of selectable) { if (allPageSelected) next.delete(row.id); else next.set(row.id, row); }
          onChange([...next.values()]);
        }}>{t(allPageSelected ? "serversPage.targets.clearPage" : "serversPage.targets.selectPage")}</ActionButton>
      <ActionButton variant="secondary" disabled={!selected.length} onClick={() => onChange([])}>{t("serversPage.command.deselectAll")}</ActionButton>
      <span role="status">{t("serversPage.targets.summary", { count: selected.length, total: data?.total ?? 0 })}</span>
    </div>
    {pending ? <InlineLoading label={t("common.loading")} /> : state.error ? <div role="alert">
      <p>{t("serversPage.inventory.loadFailed")}</p>
      <ActionButton variant="secondary" onClick={() => setRequest({ ...request, attempt: request.attempt + 1 })}>{t("common.retry")}</ActionButton>
    </div> : !rows.length ? <EmptyState text={t("serversPage.inventory.noResults")} /> : <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => <label key={row.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
        <input type="checkbox" checked={ids.has(row.id)} disabled={kind === "command" && !row.available}
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" onChange={(event) => onChange(event.target.checked
            ? [...selected.filter((item) => item.id !== row.id), row] : selected.filter((item) => item.id !== row.id))} />
        <span className="min-w-0">
          <span className="block truncate font-medium">{row.name}</span>
          <span className="block truncate font-mono text-xs text-[var(--text-muted)]">{row.host}</span>
          {kind === "batch" ? <span className="text-xs text-[var(--text-muted)]">{t(row.enabled ? "serversPage.batchPanel.enabled" : "serversPage.batchPanel.disabled")}</span>
            : row.reason ? <span className="text-xs text-[var(--danger)]">{t(row.reason === "setup-incomplete" ? "serversPage.command.nodeSetupIncomplete" : "serversPage.command.nodeRecentlyOffline")}</span> : null}
        </span>
      </label>)}
    </div>}
    {data && !state.error && <nav aria-label={t("common.pagination.label")} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-sm">
      <ActionButton variant="secondary" disabled={pending || data.page <= 1} onClick={() => setRequest({ ...request, page: data.page - 1 })}>{t("common.pagination.previous")}</ActionButton>
      <span>{data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}</span>
      <ActionButton variant="secondary" disabled={pending || data.page * data.pageSize >= data.total} onClick={() => setRequest({ ...request, page: data.page + 1 })}>{t("common.pagination.next")}</ActionButton>
    </nav>}
  </section>;
}
