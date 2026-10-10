"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Folder } from "@/components/icons";
import { ActionButton } from "@/components/action-button";
import { Dialog } from "@/components/ui/dialog";
import { Pagination } from "@/components/pagination";
import { IconButton, InlineLoading, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import type { FilesApiResponse } from "./files-browser-helpers";

export function FolderDestinationPicker({ nodeId, disabled, onSelect }: {
  nodeId: string;
  disabled?: boolean;
  onSelect: (path: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <>
    <ActionButton type="button" variant="secondary" disabled={disabled} icon={<Folder aria-hidden />} onClick={() => setOpen(true)}>
      {t("filesPage.move.chooseFolder")}
    </ActionButton>
    {open ? <FolderDestinationDialog key={nodeId} nodeId={nodeId} onClose={() => setOpen(false)} onSelect={(path) => {
      onSelect(path);
      setOpen(false);
    }} /> : null}
  </>;
}

function FolderDestinationDialog({ nodeId, onClose, onSelect }: {
  nodeId: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const { t } = useI18n();
  const [path, setPath] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<FilesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadError = t("filesBrowserSpa.fileListRefreshFailed");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ nodeId, page: String(page), pageSize: "50" });
    if (path) params.set("path", path);
    if (page > 1) params.set("sync", "0");
    void csrfFetch<FilesApiResponse>(`/api/files/list?${params}`, { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted) setData(response);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(getErrorMessage(cause, loadError));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [nodeId, path, page, retry, loadError]);

  const navigate = useCallback((next: string, nextPage = 1) => {
    setLoading(true);
    setError("");
    setData(null);
    setPath(next);
    setPage(nextPage);
  }, []);

  return <Dialog
    size="lg"
    open
    onClose={onClose}
    title={t("filesPage.move.chooseFolder")}
    footer={<>
      <ActionButton variant="secondary" onClick={onClose}>{t("common.cancel")}</ActionButton>
      <ActionButton disabled={loading || !!error || !data} onClick={() => onSelect(path || ".")}>
        {t("filesPage.move.useFolder")}
      </ActionButton>
    </>}
  >
    <div className="space-y-3">
    <div className="flex min-w-0 items-center gap-2">
      <IconButton label={t("fileListClient.upLevel")} disabled={!path || loading}
        onClick={() => navigate(path.split("/").slice(0, -1).join("/"))}><ChevronRight size={18} className="-rotate-90" aria-hidden /></IconButton>
      <span className="min-w-0 break-all text-sm">/{path}</span>
    </div>
    {error ? <Notice tone="danger" action={{ label: t("common.retry"), onClick: () => {
      setError(""); setLoading(true); setRetry((value) => value + 1);
    } }}>{error}</Notice> : null}
    {data?.syncWarning ? <Notice tone="warning">{data.syncWarning}</Notice> : null}
    <div data-inset aria-busy={loading} className="max-h-72 min-h-40 overflow-y-auto">
      {loading ? <InlineLoading label={t("common.loading")} className="p-3" /> : !error && data?.folders.length === 0 ?
        <p className="p-3 text-sm text-[var(--text-muted)]">{t("filesPage.move.noFoldersOnPage")}</p> : null}
      {!loading && !error ? data?.folders.map((folder) => <button key={folder.path} type="button"
        className="flex min-h-11 w-full items-center gap-2 border-b border-[var(--border-subtle)] px-3 text-left text-sm last:border-b-0 hover:bg-[var(--surface-hover)]"
        onClick={() => navigate(folder.relativePath ?? folder.path)}>
        <Folder size={18} className="shrink-0" aria-hidden /><span className="min-w-0 break-all">{folder.displayName ?? folder.name}</span>
      </button>) : null}
    </div>
    {data?.pagination ? <Pagination {...data.pagination} loading={loading} onPageChange={(next) => navigate(path, next)} /> : null}
    </div>
  </Dialog>;
}
