"use client";

import { useCallback, useEffect, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

export type QuickServiceMessage = {
  type: "ok" | "err";
  text: string;
  taskId?: string | null;
};

export type QuickServiceActionResult = {
  success?: boolean;
  queued?: boolean;
  jobId?: string;
  taskId?: string;
  message?: string;
  status?: string;
  updated?: boolean;
  health?: string | null;
  logTail?: string | null;
};

export type QuickServiceCatalogItem = {
  slug: string;
  name: string;
  defaultPort: number;
  port: number | null;
  status: string;
};

export type ConfigPreviewAction = "install" | "update";

export type ConfigPreviewItem = {
  slug: string;
  name: string;
  defaultPort: number;
  port: number | null;
};

export type ConfigPreview<TItem extends ConfigPreviewItem = ConfigPreviewItem> = {
  action: ConfigPreviewAction;
  item: TItem;
  port: number;
};

export type AddSourceInput = {
  name: string;
  displayName: string;
  url: string;
  type: "json" | "github" | "linuxserver";
};

export type UninstallTarget = {
  slug: string;
  deleteVolumes: boolean;
};

export type UseQuickServiceActionsInput = {
  fetchCatalog: () => Promise<void>;
  fetchSources: () => Promise<void>;
  /** empty = hub-host */
  selectedServerId?: string;
};

export type UseQuickServiceActionsResult = {
  message: QuickServiceMessage | null;
  actionSlug: string | null;
  syncing: string | null;
  showMessage: (msg: QuickServiceMessage) => void;
  doInstall: (preview: ConfigPreview) => Promise<void>;
  doAction: (slug: string, action: string) => Promise<void>;
  doUninstall: (target: UninstallTarget) => Promise<void>;
  doSync: (sourceId?: string) => Promise<void>;
  doToggleSource: (sourceId: string, enabled: boolean) => Promise<void>;
  doDeleteSource: (id: string) => Promise<void>;
  doAddSource: (input: AddSourceInput) => Promise<boolean>;
};

/**
 * Action handlers + transient UI state for the Quick Services page.
 *
 * Centralises the install / lifecycle / source CRUD flow that previously
 * lived inline in quick-services-client.tsx. The component still owns
 * catalog data, form state and dialog state; this hook owns everything
 * that talks to `/api/quick-services` and `/api/app-sources` and the
 * "current action in flight" indicators (`actionSlug`, `syncing`).
 *
 * The `message` state is auto-dismissed after 4s, matching the original
 * inline behaviour.
 */
export function useQuickServiceActions({
  fetchCatalog,
  fetchSources,
  selectedServerId = "",
}: UseQuickServiceActionsInput): UseQuickServiceActionsResult {
  const { t } = useI18n();
  const [message, setMessage] = useState<QuickServiceMessage | null>(null);
  const [actionSlug, setActionSlug] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  // Auto-dismiss message after 4s, matching the original inline behaviour.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const showMessage = useCallback((msg: QuickServiceMessage) => {
    setMessage(msg);
  }, []);

  const doInstall = useCallback(
    async (preview: ConfigPreview) => {
      setActionSlug(preview.item.slug);
      try {
        const data = await csrfFetch<QuickServiceActionResult>(
          "/api/quick-services",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug: preview.item.slug, customPort: preview.port, serverId: selectedServerId || null }),
          },
        );
        setMessage({
          type: "ok",
          text: data.taskId
            ? t("qsActions.queued").replace("{name}", preview.item.name).replace("{taskId}", data.taskId)
            : t("qsActions.submitted").replace("{name}", preview.item.name),
          taskId: data.taskId,
        });
        setTimeout(fetchCatalog, 1500);
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : t("qsActions.installFailed"),
        });
      } finally {
        setActionSlug(null);
      }
    },
    [fetchCatalog, selectedServerId, t],
  );

  const doAction = useCallback(
    async (slug: string, action: string) => {
      setActionSlug(slug);
      try {
        const data = await csrfFetch<QuickServiceActionResult>(
          `/api/quick-services/${slug}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, serverId: selectedServerId || null }),
          },
        );
        const updateDetails = [
          data.health ? t("qsActions.healthDetail").replace("{health}", data.health) : null,
          data.logTail
            ? t("qsActions.logTailDetail").replace("{tail}", data.logTail.split("\n").slice(-2).join(" / "))
            : null,
        ]
          .filter(Boolean)
          .join("; ");
        const queuedSuffix = data.taskId ? t("qsActions.taskSuffix").replace("{id}", data.taskId) : "";
        const actionMessages: Record<string, string> = data.queued
          ? {
              start: t("qsActions.queuedStart").replace("{task}", queuedSuffix),
              stop: t("qsActions.queuedStop").replace("{task}", queuedSuffix),
              sync: t("qsActions.queuedSync").replace("{task}", queuedSuffix),
              update: t("qsActions.queuedUpdate").replace("{task}", queuedSuffix),
            }
          : {
              start: t("qsActions.started"),
              stop: t("qsActions.stopped"),
              sync:
                data.status === "running"
                  ? t("qsActions.syncRunning")
                  : t("qsActions.syncStopped"),
              update: updateDetails
                ? t("qsActions.updateDetails").replace("{details}", updateDetails)
                : t("qsActions.updateSimple"),
            };
        setMessage({
          type: "ok",
          text: actionMessages[action] ?? t("qsActions.opComplete"),
          taskId: data.taskId,
        });
        fetchCatalog();
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : t("qsActions.opFailed"),
        });
      } finally {
        setActionSlug(null);
      }
    },
    [fetchCatalog, selectedServerId, t],
  );

  const doUninstall = useCallback(
    async (target: UninstallTarget) => {
      setActionSlug(target.slug);
      try {
        const data = await csrfFetch<QuickServiceActionResult>(
          `/api/quick-services/${target.slug}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deleteVolumes: target.deleteVolumes, serverId: selectedServerId || null }),
          },
        );
        const taskLabel = data.taskId ? t("qsActions.taskSuffix").replace("{id}", data.taskId) : "";
        setMessage({
          type: "ok",
          text: data.queued
            ? target.deleteVolumes
              ? t("qsActions.uninstallAndDeleteQueued").replace("{task}", taskLabel)
              : t("qsActions.uninstallKeepQueued").replace("{task}", taskLabel)
            : target.deleteVolumes
              ? t("qsActions.uninstallAndDeleteDone")
              : t("qsActions.uninstallKeepDone"),
          taskId: data.taskId,
        });
        fetchCatalog();
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : t("qsActions.uninstallFailed"),
        });
      } finally {
        setActionSlug(null);
      }
    },
    [fetchCatalog, selectedServerId, t],
  );

  const doSync = useCallback(
    async (sourceId?: string) => {
      setSyncing(sourceId ?? "all");
      try {
        await csrfFetch("/api/app-sources", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync", sourceId }),
        });
        setMessage({ type: "ok", text: t("qsActions.syncDone") });
        await fetchSources();
        await fetchCatalog();
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : t("qsActions.syncFailed"),
        });
      } finally {
        setSyncing(null);
      }
    },
    [fetchCatalog, fetchSources, t],
  );

  const doToggleSource = useCallback(
    async (sourceId: string, enabled: boolean) => {
      try {
        await csrfFetch("/api/app-sources", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "toggle", sourceId, enabled }),
        });
        fetchSources();
        if (!enabled) fetchCatalog();
      } catch {
        // API call failed — surface a generic error toast to the user.
        setMessage({ type: "err", text: t("qsActions.opFailed") });
      }
    },
    [fetchCatalog, fetchSources, t],
  );

  const doDeleteSource = useCallback(
    async (id: string) => {
      try {
        await csrfFetch(`/api/app-sources?sourceId=${id}`, { method: "DELETE" });
        setMessage({ type: "ok", text: t("qsActions.sourceDeleted") });
        await fetchSources();
        await fetchCatalog();
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : t("qsActions.deleteFailed"),
        });
      }
    },
    [fetchCatalog, fetchSources, t],
  );

  const doAddSource = useCallback(
    async (input: AddSourceInput) => {
      if (!input.name.trim() || !input.displayName.trim() || !input.url.trim()) {
        setMessage({ type: "err", text: t("qsActions.addSourceEmpty") });
        return false;
      }
      try {
        await csrfFetch("/api/app-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: input.name.trim(),
            displayName: input.displayName.trim(),
            url: input.url.trim(),
            type: input.type,
          }),
        });
        setMessage({ type: "ok", text: t("qsActions.addSourceDone") });
        await fetchSources();
        return true;
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : t("qsActions.addSourceFailed"),
        });
        return false;
      }
    },
    [fetchSources, t],
  );

  return {
    message,
    actionSlug,
    syncing,
    showMessage,
    doInstall,
    doAction,
    doUninstall,
    doSync,
    doToggleSource,
    doDeleteSource,
    doAddSource,
  };
}
