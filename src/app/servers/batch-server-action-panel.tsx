"use client";

import { useActionState, useMemo, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";
import { batchToggleServerAction, type ServerActionState } from "./actions";

const initialState: ServerActionState = {};

type BatchServerActionPanelProps = {
  servers: { id: string; name: string; enabled: boolean }[];
  enabledCount: number;
};

export function BatchServerActionPanel({
  servers,
  enabledCount,
}: BatchServerActionPanelProps) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(batchToggleServerAction, initialState);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [disableConfirming, setDisableConfirming] = useState(false);

  const selectedServers = useMemo(
    () => servers.filter((server) => selectedIds.includes(server.id)),
    [servers, selectedIds],
  );
  const enabledSelectedCount = selectedServers.filter((server) => server.enabled).length;
  const disabledSelectedCount = selectedServers.length - enabledSelectedCount;
  const allSelected = selectedIds.length === servers.length && servers.length > 0;
  const someSelected = selectedIds.length > 0 && selectedIds.length < servers.length;

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : servers.map((server) => server.id));
    setDisableConfirming(false);
  };

  const updateSelection = (serverId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? Array.from(new Set([...current, serverId]))
        : current.filter((id) => id !== serverId),
    );
    setDisableConfirming(false);
  };

  return (
    <section data-card className="mb-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-medium text-[var(--text-primary)]">
            {t("serversPage.batchPanel.title")}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("serversPage.batchPanel.desc")}
          </p>
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          {t("serversPage.batchPanel.summary")
            .replace("{enabledCount}", String(enabledCount))
            .replace("{selectedCount}", String(selectedServers.length))}
        </div>
      </div>

      {state.error ? (
        <div data-tone="rose" className="mt-4 rounded-lg border border-[var(--danger-border)] px-3.5 py-2.5 text-sm text-[var(--danger)]">
          {state.error}
        </div>
      ) : null}
      {state.success ? (
        <div data-tone="emerald" className="mt-4 rounded-lg border border-[var(--success-border)] px-3.5 py-2.5 text-sm text-[var(--success)]">
          {state.success}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <button
          type="button"
          onClick={toggleAll}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)]"
          aria-pressed={allSelected}
        >
          {allSelected ? t("serversPage.batchPanel.clear") : t("serversPage.batchPanel.selectAll")}
        </button>
        {someSelected ? <span aria-hidden="true">·</span> : null}
        <span>{t("serversPage.batchPanel.enabled")}: {enabledSelectedCount}</span>
        <span>{t("serversPage.batchPanel.disabled")}: {disabledSelectedCount}</span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {servers.map((server) => {
          const checked = selectedIds.includes(server.id);
          return (
            <label
              key={server.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-secondary)]"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => updateSelection(server.id, event.currentTarget.checked)}
                className="h-4 w-4 rounded border-[var(--border)]"
              />
              <span className="min-w-0 flex-1 truncate">{server.name}</span>
              <span className="text-xs text-[var(--text-muted)]">
                {server.enabled ? t("serversPage.batchPanel.enabled") : t("serversPage.batchPanel.disabled")}
              </span>
            </label>
          );
        })}
      </div>

      <form action={formAction} className="mt-4 flex flex-wrap gap-2">
        {selectedIds.map((id) => (
          <input key={id} type="hidden" name="serverIds" value={id} />
        ))}
        <input type="hidden" name="enabled" value="true" />
        <SubmitButton
          disabled={selectedIds.length === 0}
          pendingLabel={t("serversPage.batchPanel.processing")}
          className="rounded-lg bg-[var(--color-action)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] disabled:opacity-50"
        >
          {t("serverCardActions.toggle.enable")}
        </SubmitButton>
      </form>

      <form action={formAction} className="mt-2 flex flex-wrap gap-2">
        {selectedIds.map((id) => (
          <input key={id} type="hidden" name="serverIds" value={id} />
        ))}
        <input type="hidden" name="enabled" value="false" />
        {!disableConfirming ? (
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => setDisableConfirming(true)}
            className="rounded-lg border border-[var(--warning-border)] px-4 py-2 text-sm font-medium text-[var(--warning)] disabled:opacity-50"
          >
            {t("serverCardActions.toggle.disable")}
          </button>
        ) : (
          <SubmitButton
            pendingLabel={t("serversPage.batchPanel.processing")}
            className="rounded-lg border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)]"
          >
            {t("serverCardActions.toggle.disable")}
          </SubmitButton>
        )}
      </form>
    </section>
  );
}
