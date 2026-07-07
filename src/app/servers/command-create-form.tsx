"use client";
import { useActionState, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { SubmitButton } from "@/components/submit-button";
import {
  createCommandRequestAction,
  type CommandActionState,
} from "./command-actions";
const initialState: CommandActionState = {};
type ServerOption = {
  id: string;
  name: string;
  host: string;
  enabled: boolean;
};
export function CommandCreateForm({ servers }: { servers: ServerOption[] }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(
    createCommandRequestAction,
    initialState,
  );
  const enabledServerIds = useMemo(
    () => servers.filter((server) => server.enabled).map((server) => server.id),
    [servers],
  );
  const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleServer = (id: string) => {
    setSelectedServerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    if (enabledServerIds.length === 0) return;
    if (selectedServerIds.size === enabledServerIds.length) {
      setSelectedServerIds(new Set());
    } else {
      setSelectedServerIds(new Set(enabledServerIds));
    }
  };
  return (
    <form action={formAction} data-card className="grid gap-4 ">
      {" "}
      <div>
        {" "}
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("serversPage.command.title")}
        </h2>{" "}
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("serversPage.command.desc")}
        </p>{" "}
      </div>{" "}
      {state.error && (
        <div className="rounded-lg bg-[var(--danger)]/[0.10] border border-[var(--danger-border)] px-3.5 py-2.5 text-sm text-[var(--danger)]">
          {state.error}
        </div>
      )}{" "}
      {state.success && (
        <div className="rounded-lg bg-[var(--success)]/[0.10] border border-[var(--success-border)] px-3.5 py-2.5 text-sm text-[var(--success)]">
          {state.success}
        </div>
      )}{" "}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
          htmlFor="cmdTitle"
        >
          {t("serversPage.command.titleLabel")}
        </label>{" "}
        <input
          id="cmdTitle"
          name="title"
          type="text"
          required
          placeholder={t("serversPage.command.titlePlaceholder")}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10]"
        />{" "}
      </div>{" "}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
          htmlFor="cmdCommand"
        >
          {t("serversPage.command.bodyLabel")}
        </label>{" "}
        <textarea
          id="cmdCommand"
          name="command"
          rows={4}
          required
          placeholder="df -h"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10] resize-y"
        />{" "}
      </div>{" "}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
          htmlFor="cmdReason"
        >
          {t("serversPage.command.reasonLabel")}
        </label>{" "}
        <textarea
          id="cmdReason"
          name="reason"
          rows={2}
          placeholder={t("common.optional")}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface)]/[0.10] resize-y"
        />{" "}
      </div>{" "}
      <div className="space-y-2">
        {" "}
        <div className="flex items-center justify-between">
          {" "}
          <label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">
            {t("serversPage.command.targetNodes")}
          </label>{" "}
          <button
            type="button"
            onClick={selectAll}
            className="text-xs text-[var(--color-action)]/70 hover:text-[var(--color-action)] light:hover:text-[var(--color-action-strong)] transition"
          >
            {" "}
            {selectedServerIds.size === enabledServerIds.length
              ? t("serversPage.command.deselectAll")
              : t("serversPage.command.selectAllEnabled")}{" "}
          </button>{" "}
        </div>{" "}
        {servers.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            {t("serversPage.command.noAvailableNodes")}
          </p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {" "}
            {servers.map((server) => (
              <label
                key={server.id}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${!server.enabled ? "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-muted)] cursor-not-allowed opacity-50" : selectedServerIds.has(server.id) ? "border-[var(--color-action-border)]/20 bg-[var(--color-action-bg)]/[0.10] text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10]"}`}
              >
                {" "}
                <input
                  type="checkbox"
                  name="serverIds"
                  value={server.id}
                  checked={selectedServerIds.has(server.id)}
                  disabled={!server.enabled}
                  onChange={() => toggleServer(server.id)}
                  className="accent-[var(--color-action)]"
                />{" "}
                <span>{server.name}</span>{" "}
                <span className="ml-auto text-[11px] text-[var(--text-muted)]">
                  {server.host}
                </span>{" "}
              </label>
            ))}{" "}
          </div>
        )}{" "}
      </div>{" "}
      <SubmitButton pendingLabel={t("common.submitting")}>
        {t("serversPage.command.submit")}
      </SubmitButton>{" "}
    </form>
  );
}
