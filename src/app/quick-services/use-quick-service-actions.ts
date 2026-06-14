"use client";

import { useCallback, useEffect, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

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
  doAddSource: (input: AddSourceInput) => Promise<void>;
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
}: UseQuickServiceActionsInput): UseQuickServiceActionsResult {
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
            body: JSON.stringify({ slug: preview.item.slug, customPort: preview.port }),
          },
        );
        setMessage({
          type: "ok",
          text: data.taskId
            ? `${preview.item.name} 安装已排队（${data.taskId}），可在任务中心查看进度。`
            : `${preview.item.name} 安装任务已提交，正在拉取镜像…`,
          taskId: data.taskId,
        });
        setTimeout(fetchCatalog, 1500);
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : "安装失败",
        });
      } finally {
        setActionSlug(null);
      }
    },
    [fetchCatalog],
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
            body: JSON.stringify({ action }),
          },
        );
        const updateDetails = [
          data.health ? `健康状态：${data.health}` : null,
          data.logTail
            ? `最近日志：${data.logTail.split("\n").slice(-2).join(" / ")}`
            : null,
        ]
          .filter(Boolean)
          .join("；");
        const queuedSuffix = data.taskId ? `（${data.taskId}）` : "";
        const actionMessages: Record<string, string> = data.queued
          ? {
              start: `启动已排队${queuedSuffix}，可在任务中心查看进度。`,
              stop: `停止已排队${queuedSuffix}，可在任务中心查看进度。`,
              sync: `状态刷新已排队${queuedSuffix}，可在任务中心查看进度。`,
              update: `更新已排队${queuedSuffix}，后台将拉取镜像并重建容器。`,
            }
          : {
              start: "已启动",
              stop: "已停止",
              sync:
                data.status === "running"
                  ? "状态已刷新：运行中"
                  : "状态已刷新：已停止",
              update: updateDetails
                ? `更新完成，已拉取镜像并重建容器；${updateDetails}`
                : "更新完成，已拉取镜像并重建容器",
            };
        setMessage({
          type: "ok",
          text: actionMessages[action] ?? "操作完成",
          taskId: data.taskId,
        });
        fetchCatalog();
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : "操作失败",
        });
      } finally {
        setActionSlug(null);
      }
    },
    [fetchCatalog],
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
            body: JSON.stringify({ deleteVolumes: target.deleteVolumes }),
          },
        );
        const taskLabel = data.taskId ? `（${data.taskId}）` : "";
        setMessage({
          type: "ok",
          text: data.queued
            ? target.deleteVolumes
              ? `卸载并删除数据目录已排队${taskLabel}`
              : `卸载已排队${taskLabel}，数据目录将保留`
            : target.deleteVolumes
              ? "已卸载并删除数据目录"
              : "已卸载，数据目录已保留",
          taskId: data.taskId,
        });
        fetchCatalog();
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : "卸载失败",
        });
      } finally {
        setActionSlug(null);
      }
    },
    [fetchCatalog],
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
        setMessage({ type: "ok", text: "同步完成，正在刷新应用列表…" });
        await fetchSources();
        await fetchCatalog();
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : "同步失败",
        });
      } finally {
        setSyncing(null);
      }
    },
    [fetchCatalog, fetchSources],
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
        setMessage({ type: "err", text: "操作失败" });
      }
    },
    [fetchCatalog, fetchSources],
  );

  const doDeleteSource = useCallback(
    async (id: string) => {
      try {
        await csrfFetch(`/api/app-sources?sourceId=${id}`, { method: "DELETE" });
        setMessage({ type: "ok", text: "源已删除" });
        await fetchSources();
        await fetchCatalog();
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : "删除失败",
        });
      }
    },
    [fetchCatalog, fetchSources],
  );

  const doAddSource = useCallback(
    async (input: AddSourceInput) => {
      if (!input.name.trim() || !input.displayName.trim() || !input.url.trim()) {
        setMessage({ type: "err", text: "请先填写完整的源信息" });
        return;
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
        setMessage({ type: "ok", text: "应用源已添加" });
        await fetchSources();
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : "添加失败",
        });
      }
    },
    [fetchSources],
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
