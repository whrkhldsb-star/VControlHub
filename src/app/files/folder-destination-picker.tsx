"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Folder, X } from "@/components/icons";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";
import { Pagination } from "@/components/pagination";
import { IconButton, Notice } from "@/components/ui-primitives";
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
    <ActionButton type="button" variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
      <Folder size={16} aria-hidden />{t("filesPage.move.chooseFolder")}
    </ActionButton>
    <ModalShell open={open} onClose={() => setOpen(false)} label={t("filesPage.move.chooseFolder")}
      panelClassName="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--modal-bg)] p-4 shadow-xl">
      {open ? <FolderDestinationBrowser key={nodeId} nodeId={nodeId} onClose={() => setOpen(false)} onSelect={(path) => {
        onSelect(path);
        setOpen(false);
      }} /> : null}
    </ModalShell>
  </>;
}

function FolderDestinationBrowser({ nodeId, onClose, onSelect }: {
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

  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-base font-semibold">{t("filesPage.move.chooseFolder")}</h3>
      <IconButton label={t("common.close")} onClick={onClose}><X size={18} aria-hidden /></IconButton>
    </div>
    <div className="flex min-w-0 items-center gap-2">
      <IconButton label={t("fileListClient.upLevel")} disabled={!path || loading}
        onClick={() => navigate(path.split("/").slice(0, -1).join("/"))}><ChevronRight size={18} className="-rotate-90" aria-hidden /></IconButton>
      <span className="min-w-0 break-all text-sm">/{path}</span>
    </div>
    {error ? <Notice tone="danger" action={{ label: t("common.retry"), onClick: () => {
      setError(""); setLoading(true); setRetry((value) => value + 1);
    } }}>{error}</Notice> : null}
    {data?.syncWarning ? <Notice tone="warning">{data.syncWarning}</Notice> : null}
    <div aria-busy={loading} className="min-h-40 max-h-72 overflow-y-auto border-y border-[var(--border)]">
      {loading ? <p role="status" className="p-3 text-sm">{t("common.loading")}</p> : !error && data?.folders.length === 0 ?
        <p className="p-3 text-sm text-[var(--text-muted)]">{t("filesPage.move.noFoldersOnPage")}</p> : null}
      {!loading && !error ? data?.folders.map((folder) => <button key={folder.path} type="button"
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-[var(--surface-hover)]"
        onClick={() => navigate(folder.relativePath ?? folder.path)}>
        <Folder size={18} className="shrink-0" aria-hidden /><span className="min-w-0 break-all">{folder.displayName ?? folder.name}</span>
      </button>) : null}
    </div>
    {data?.pagination ? <Pagination {...data.pagination} loading={loading} onPageChange={(next) => navigate(path, next)} /> : null}
    <div className="flex flex-wrap justify-end gap-2">
      <ActionButton variant="secondary" onClick={onClose}>{t("common.cancel")}</ActionButton>
      <ActionButton disabled={loading || !!error || !data} onClick={() => onSelect(path || ".")}>
        {t("filesPage.move.useFolder")}
      </ActionButton>
    </div>
  </div>;
}
