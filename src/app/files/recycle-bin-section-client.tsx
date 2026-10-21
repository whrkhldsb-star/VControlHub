"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatBytes } from "@/lib/format/bytes";
import { Pagination } from "@/components/pagination";
import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RotateCcw, Trash2, X } from "@/components/icons";
import { InlineLoading, Notice } from "@/components/ui-primitives";
import { useToast } from "@/components/toast-provider";
import { getErrorMessage } from "@/lib/http/error-message";
import { permanentDeleteFileEntryAction, restoreFileEntryAction } from "../storage/actions";
import { FileTypeIcon } from "./file-entry-icons";
import { formatEntryTime } from "./file-entry-utils";
import { RestoreButton } from "./restore-button";
import { PermanentDeleteButton } from "./permanent-delete-button";

export type DeletedEntryProp = {
  id: string;
  name: string;
  entryType: string;
  relativePath: string;
  size: number | bigint | null;
  mimeType?: string | null;
  /** When it went to the recycle bin (the entry's last change). */
  deletedAt?: string | Date | null;
  storageNodeName?: string | null;
};

type BulkState = { action: "restore" | "delete"; done: number; total: number } | null;

export function RecycleBinSectionClient({ deletedEntries, canDelete, onRefresh, pagination }: {
  deletedEntries: DeletedEntryProp[];
  canDelete: boolean;
  onRefresh?: () => void;
  pagination?: { page: number; pageSize: number; totalItems: number };
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { addToast } = useToast();
  const [loading, startTransition] = useTransition();
  const [dismissedEntryIds, setDismissedEntryIds] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulk, setBulk] = useState<BulkState>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const visibleEntries = deletedEntries.filter((entry) => !dismissedEntryIds.has(entry.id));
  const totalItems = Math.max(0, (pagination?.totalItems ?? deletedEntries.length) - dismissedEntryIds.size);
  const selectedEntries = visibleEntries.filter((entry) => selected.has(entry.id));
  const allSelected = visibleEntries.length > 0 && selectedEntries.length === visibleEntries.length;

  const refresh = () => {
    onRefresh?.();
    startTransition(() => router.refresh());
  };
  const handleEntryCompleted = (entryId: string) => {
    setDismissedEntryIds((current) => new Set(current).add(entryId));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(entryId);
      return next;
    });
    refresh();
  };
  const navigate = (page: number, pageSize = pagination?.pageSize ?? 50) => {
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    setSelected(new Set());
    startTransition(() => router.push(`${window.location.pathname}?${params}`, { scroll: false }));
  };
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  /** Restore or purge the selection one entry at a time, keeping what failed selected. */
  async function runBulk(action: "restore" | "delete") {
    const targets = selectedEntries;
    if (!targets.length || bulk) return;
    setBulk({ action, done: 0, total: targets.length });
    setErrors([]);
    const failures: string[] = [];
    const finished = new Set<string>();
    for (const [index, entry] of targets.entries()) {
      const formData = new FormData();
      formData.set("fileEntryId", entry.id);
      try {
        const result = action === "restore"
          ? await restoreFileEntryAction(null, formData)
          : await permanentDeleteFileEntryAction(null, formData);
        if (result?.error) failures.push(`${entry.name}: ${result.error}`);
        else finished.add(entry.id);
      } catch (error) {
        failures.push(`${entry.name}: ${getErrorMessage(error, t("filePreferences.failed"))}`);
      }
      setBulk({ action, done: index + 1, total: targets.length });
    }
    setDismissedEntryIds((current) => new Set([...current, ...finished]));
    setSelected(new Set(targets.filter((entry) => !finished.has(entry.id)).map((entry) => entry.id)));
    setErrors(failures);
    setBulk(null);
    if (finished.size) {
      addToast(failures.length ? "warning" : "success", t(action === "restore" ? "recycleBinSection.bulk.restored" : "recycleBinSection.bulk.deleted", { count: finished.size }));
      refresh();
    }
  }

  const actions = (entry: DeletedEntryProp) => canDelete ? (
    <div className="flex flex-wrap items-start gap-2">
      <RestoreButton fileEntryId={entry.id} onRefresh={() => handleEntryCompleted(entry.id)} />
      <PermanentDeleteButton fileEntryId={entry.id} entryName={entry.name} onRefresh={() => handleEntryCompleted(entry.id)} />
    </div>
  ) : <span className="text-xs text-[var(--text-muted)]">{t("recycleBinSection.noPermission")}</span>;
  const typeLabel = (entry: DeletedEntryProp) => t(entry.entryType === "DIRECTORY" ? "recycleBinSection.entryType.directory" : "recycleBinSection.entryType.file");
  const sizeLabel = (entry: DeletedEntryProp) => entry.entryType === "DIRECTORY" ? "—" : formatBytes(typeof entry.size === "bigint" ? Number(entry.size) : entry.size);
  const deletedLabel = (entry: DeletedEntryProp) => formatEntryTime(entry.deletedAt ?? null, locale);
  const location = (entry: DeletedEntryProp) => [entry.storageNodeName, `/${entry.relativePath}`].filter(Boolean).join(" · ");
  const checkbox = (entry: DeletedEntryProp) => canDelete ? (
    <input
      type="checkbox"
      checked={selected.has(entry.id)}
      onChange={() => toggle(entry.id)}
      disabled={bulk !== null}
      aria-label={t("fileListClient.selectFileAria", { name: entry.name })}
      className="h-4 w-4 cursor-pointer accent-[var(--color-action)]"
    />
  ) : null;

  return (
    <section aria-label={t("recycleBinSection.title")} aria-busy={loading || bulk !== null} className="mt-6 flex min-w-0 flex-col gap-4">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        {selectedEntries.length > 0 ? (
          <div role="region" aria-label={t("recycleBinSection.bulk.region")} className="flex flex-wrap items-center gap-2">
            <ActionButton size="sm" variant="ghost" square aria-label={t("filesPage.batchToolbar.clearSelection")} disabled={bulk !== null} onClick={() => setSelected(new Set())}>
              <X aria-hidden />
            </ActionButton>
            <span className="text-sm font-medium text-[var(--text-primary)]">{t("filesPage.batchToolbar.selectedCount", { count: selectedEntries.length })}</span>
            <ActionButton size="sm" variant="secondary" icon={<RotateCcw aria-hidden />} loading={bulk?.action === "restore"} disabled={bulk !== null} onClick={() => void runBulk("restore")}>
              {bulk?.action === "restore" ? t("recycleBinSection.bulk.progress", { done: bulk.done, total: bulk.total }) : t("recycleBinSection.bulk.restore")}
            </ActionButton>
            <ActionButton size="sm" variant="danger" icon={<Trash2 aria-hidden />} loading={bulk?.action === "delete"} disabled={bulk !== null} onClick={() => setConfirmDelete(true)}>
              {bulk?.action === "delete" ? t("recycleBinSection.bulk.progress", { done: bulk.done, total: bulk.total }) : t("recycleBinSection.bulk.delete")}
            </ActionButton>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-secondary)]">{t("recycleBinSection.summary", { count: totalItems })}</p>
        )}
      </div>
      {errors.length ? (
        <Notice tone="warning" title={t("recycleBinSection.bulk.failures", { count: errors.length })} onDismiss={() => setErrors([])} dismissLabel={t("common.close")}>
          <ul className="max-h-32 overflow-y-auto text-xs">
            {errors.map((error) => <li key={error} className="break-all">{error}</li>)}
          </ul>
        </Notice>
      ) : null}
      {visibleEntries.length === 0 ? (
        totalItems === 0 ? (
          <div data-empty-state className="flex flex-col items-center gap-3 border-y border-[var(--border)] px-6 py-14 text-center">
            <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-[var(--surface-subtle)] text-[var(--text-muted)]"><Trash2 size={24} /></span>
            <p className="text-sm text-[var(--text-muted)]">{t("recycleBinSection.empty")}</p>
          </div>
        ) : (
          <InlineLoading label={t("common.loading")} className="border-y border-[var(--border)] py-8" />
        )
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] table-fixed text-left text-sm">
              <thead className="border-y border-[var(--border)] bg-[var(--surface-subtle)] text-xs text-[var(--text-muted)]">
                <tr>
                  <th scope="col" className="w-10 px-3 py-3">
                    {canDelete ? (
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(element) => {
                          if (element) element.indeterminate = selectedEntries.length > 0 && !allSelected;
                        }}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(visibleEntries.map((entry) => entry.id)))}
                        disabled={bulk !== null}
                        aria-label={t("recycleBinSection.bulk.selectAll")}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-action)]"
                      />
                    ) : null}
                  </th>
                  <th scope="col" className="w-[34%] px-3 py-3 font-medium">{t("recycleBinSection.table.name")}</th>
                  <th scope="col" className="w-[16%] px-3 py-3 font-medium">{t("recycleBinSection.table.deletedAt")}</th>
                  <th scope="col" className="w-[10%] px-3 py-3 font-medium">{t("recycleBinSection.table.size")}</th>
                  <th scope="col" className="w-[40%] px-3 py-3 font-medium">{t("recycleBinSection.table.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {visibleEntries.map((entry) => (
                  <tr key={entry.id} className={selected.has(entry.id) ? "bg-[var(--accent-bg)]" : "hover:bg-[var(--surface-hover)]"}>
                    <td className="px-3 py-3 align-middle">{checkbox(entry)}</td>
                    <td className="px-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileTypeIcon entry={{ entryType: entry.entryType, mimeType: entry.mimeType, name: entry.name }} size={32} className="shrink-0" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[var(--text-primary)]" title={entry.name}>{entry.name}</p>
                          <p className="truncate text-xs text-[var(--text-muted)]" title={location(entry)}>{location(entry)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-[var(--text-secondary)]">{deletedLabel(entry)}</td>
                    <td className="px-3 py-3 text-xs tabular-nums text-[var(--text-secondary)]">{sizeLabel(entry)}</td>
                    <td className="px-3 py-2.5">{actions(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)] md:hidden">
            {visibleEntries.map((entry) => (
              <li key={entry.id} className="flex min-w-0 gap-3 py-4">
                <div className="pt-1">{checkbox(entry)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileTypeIcon entry={{ entryType: entry.entryType, mimeType: entry.mimeType, name: entry.name }} size={28} className="shrink-0" />
                    <p className="min-w-0 break-words font-medium text-[var(--text-primary)]">{entry.name}</p>
                  </div>
                  <p className="mt-1 break-all text-xs text-[var(--text-muted)]">{location(entry)}</p>
                  <p className="my-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                    <span>{typeLabel(entry)}</span>
                    <span>{sizeLabel(entry)}</span>
                    <span>{deletedLabel(entry)}</span>
                  </p>
                  {actions(entry)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {pagination ? <Pagination {...pagination} loading={loading} onPageChange={navigate} onPageSizeChange={(size) => navigate(1, size)} /> : null}
      <ConfirmDialog
        open={confirmDelete}
        title={t("recycleBinSection.bulk.delete")}
        description={t("recycleBinSection.bulk.confirmDelete", { count: selectedEntries.length })}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("filesPage.actions.permanentDelete")}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void runBulk("delete");
        }}
      />
    </section>
  );
}
