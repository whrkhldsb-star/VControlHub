"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatBytes } from "@/lib/format/bytes";
import { Pagination } from "@/components/pagination";
import { InlineLoading } from "@/components/ui-primitives";
import { RestoreButton } from "./restore-button";
import { PermanentDeleteButton } from "./permanent-delete-button";

export type DeletedEntryProp = {
  id: string;
  name: string;
  entryType: string;
  relativePath: string;
  size: number | bigint | null;
};

export function RecycleBinSectionClient({ deletedEntries, canDelete, onRefresh, pagination }: {
  deletedEntries: DeletedEntryProp[];
  canDelete: boolean;
  onRefresh?: () => void;
  pagination?: { page: number; pageSize: number; totalItems: number };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [loading, startTransition] = useTransition();
  const [dismissedEntryIds, setDismissedEntryIds] = useState<Set<string>>(() => new Set());
  const visibleEntries = deletedEntries.filter((entry) => !dismissedEntryIds.has(entry.id));
  const totalItems = Math.max(0, (pagination?.totalItems ?? deletedEntries.length) - dismissedEntryIds.size);
  const handleEntryCompleted = (entryId: string) => {
    setDismissedEntryIds((current) => new Set(current).add(entryId));
    onRefresh?.();
    startTransition(() => router.refresh());
  };
  const navigate = (page: number, pageSize = pagination?.pageSize ?? 50) => {
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    startTransition(() => router.push(`${window.location.pathname}?${params}`, { scroll: false }));
  };
  const actions = (entry: DeletedEntryProp) => canDelete ? (
    <div className="flex flex-wrap items-start gap-2">
      <RestoreButton fileEntryId={entry.id} onRefresh={() => handleEntryCompleted(entry.id)} />
      <PermanentDeleteButton fileEntryId={entry.id} entryName={entry.name} onRefresh={() => handleEntryCompleted(entry.id)} />
    </div>
  ) : <span className="text-xs text-[var(--text-muted)]">{t("recycleBinSection.noPermission")}</span>;
  const typeLabel = (entry: DeletedEntryProp) => t(entry.entryType === "DIRECTORY" ? "recycleBinSection.entryType.directory" : "recycleBinSection.entryType.file");
  const sizeLabel = (entry: DeletedEntryProp) => formatBytes(typeof entry.size === "bigint" ? Number(entry.size) : entry.size);

  return (
    <section aria-label={t("recycleBinSection.title")} aria-busy={loading} className="mt-6 min-w-0">
      <p className="mb-4 text-sm text-[var(--text-secondary)]">{t("recycleBinSection.summary", { count: totalItems })}</p>
      {visibleEntries.length === 0 ? (
        totalItems === 0 ? (
          <p className="border-y border-[var(--border)] py-8 text-sm text-[var(--text-muted)]">{t("recycleBinSection.empty")}</p>
        ) : (
          <InlineLoading label={t("common.loading")} className="border-y border-[var(--border)] py-8" />
        )
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] table-fixed text-left text-sm">
              <thead className="border-y border-[var(--border)] bg-[var(--surface-subtle)] text-xs text-[var(--text-muted)]">
                <tr>
                  <th scope="col" className="w-[24%] px-3 py-3 font-medium">{t("recycleBinSection.table.name")}</th>
                  <th scope="col" className="w-[10%] px-3 py-3 font-medium">{t("recycleBinSection.table.type")}</th>
                  <th scope="col" className="w-[12%] px-3 py-3 font-medium">{t("recycleBinSection.table.size")}</th>
                  <th scope="col" className="w-[24%] px-3 py-3 font-medium">{t("recycleBinSection.table.path")}</th>
                  <th scope="col" className="w-[30%] px-3 py-3 font-medium">{t("recycleBinSection.table.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {visibleEntries.map((entry) => (
                  <tr key={entry.id} className="align-top hover:bg-[var(--surface-hover)]">
                    <td className="break-words px-3 py-4 font-medium text-[var(--text-primary)]">{entry.name}</td>
                    <td className="px-3 py-4 text-[var(--text-secondary)]">{typeLabel(entry)}</td>
                    <td className="px-3 py-4 tabular-nums text-[var(--text-secondary)]">{sizeLabel(entry)}</td>
                    <td className="break-all px-3 py-4 text-xs text-[var(--text-muted)]">{entry.relativePath}</td>
                    <td className="px-3 py-3">{actions(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)] md:hidden">
            {visibleEntries.map((entry) => (
              <li key={entry.id} className="min-w-0 py-4">
                <p className="break-words font-medium text-[var(--text-primary)]">{entry.name}</p>
                <p className="mt-1 break-all text-xs text-[var(--text-muted)]">{entry.relativePath}</p>
                <p className="my-3 flex gap-3 text-xs text-[var(--text-secondary)]"><span>{typeLabel(entry)}</span><span>{sizeLabel(entry)}</span></p>
                {actions(entry)}
              </li>
            ))}
          </ul>
        </>
      )}
      {pagination ? <Pagination {...pagination} loading={loading} onPageChange={navigate} onPageSizeChange={(size) => navigate(1, size)} /> : null}
    </section>
  );
}
