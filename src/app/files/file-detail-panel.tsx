"use client";

/**
 * FileDetailPanel — the right-side slide-over panel that surfaces
 * preview / download / share / media / rename / move / delete actions
 * for a single entry.
 *
 * Extracted from `file-list-client.tsx` (TR-036 T36b) so the parent
 * chunk does not pull in the `ShareFileButton` / `RenameInlineForm` /
 * `MoveInlineForm` / `DeleteConfirmButton` import graph (and their
 * sub-imports) until the user actually opens the panel. The wrapping
 * `FileDetailPanelLazy` uses `next/dynamic` to defer the chunk.
 */
import { useI18n } from "@/lib/i18n/use-locale";
import { Dialog } from "@/components/ui/dialog";
import { KeyValueList } from "@/components/ui/key-value";

import {
  DeleteConfirmButton,
  RenameInlineForm,
  MoveInlineForm,
  ShareFileButton,
} from "./file-row-actions";
import {
  buildForcedDownloadHref,
  buildMediaLibraryHref,
  formatDate,
  getPreviewHref,
  type StorageEntry,
} from "./file-entry-utils";
import { FileVersionHistoryPanel } from "./file-version-history-panel";
import { ButtonLink } from "@/components/action-button";
import { Download, Eye, ImageIcon } from "@/components/icons";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";

export type FileDetailPanelProps = {
  detailEntry: StorageEntry;
  onClose: () => void;
  canShare: boolean;
  canDelete: boolean;
  onRefresh?: () => void;
  onNotify: (type:"success" |"error" |"info", message: string) => void;
  // read/write/delete capability checks. The parent supplies these so
  // this chunk doesn't have to re-import the model layer (which would
  // defeat the lazy-load goal).
  entryCanRead: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
  entryCanWrite: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
  entryCanDelete: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
};

export function FileDetailPanel({
  detailEntry,
  onClose,
  canShare,
  canDelete,
  onRefresh,
  onNotify,
  entryCanRead,
  entryCanWrite,
  entryCanDelete,
}: FileDetailPanelProps) {
  const { t, locale } = useI18n();
  return (
    <Dialog
      size="xl"
      placement="drawer"
      open
      onClose={onClose}
      eyebrow={t("common.fileDetails")}
      title={detailEntry.name}
      description={<span className="ui-mono break-all">{detailEntry.relativePath}</span>}
      closeLabel={t("fileDetailPanel.close")}
    >
        <div className="space-y-5">
          <KeyValueList
            columns={2}
            items={[
              { label: t("fileDetailPanel.storageNode"), value: detailEntry.storageNode.name },
              { label: t("fileDetailPanel.driver"), value: getStorageDriverLabel(t, detailEntry.storageNode.driver) },
              { label: t("fileDetailPanel.size"), value: detailEntry.sizeLabel },
              { label: t("fileDetailPanel.modified"), value: detailEntry.updatedAt ? formatDate(detailEntry.updatedAt, locale) : null },
              { label: t("fileDetailPanel.accessMode"), value: detailEntry.directAccess.description, wide: true },
            ]}
          />

          <div>
            <h3 className="ui-title-caption">
              {t("fileDetailPanel.quickActions")}
            </h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {detailEntry.previewable && entryCanRead(detailEntry) ? (
                <ButtonLink href={getPreviewHref(detailEntry)} variant="outline" icon={<Eye aria-hidden />}>
                  {t("fileDetailPanel.preview")}
                </ButtonLink>
              ) : null}
              {entryCanRead(detailEntry) ? (
                <ButtonLink href={buildForcedDownloadHref(detailEntry)} download icon={<Download aria-hidden />}>
                  {t("fileDetailPanel.download")}
                </ButtonLink>
              ) : null}
              {entryCanRead(detailEntry) ? (
                <ButtonLink href={buildMediaLibraryHref(detailEntry)} icon={<ImageIcon aria-hidden />}>
                  {t("fileDetailPanel.findInMedia")}
                </ButtonLink>
              ) : null}
              {canShare && entryCanRead(detailEntry) ? (
                <ShareFileButton entry={detailEntry} />
              ) : null}
            </div>
          </div>


          {detailEntry.entryType ==="FILE" && entryCanRead(detailEntry) ? (
            <div className="border-t border-[var(--border)] pt-5">
              <FileVersionHistoryPanel
                fileEntryId={detailEntry.id}
                canWrite={entryCanWrite(detailEntry)}
                onNotify={onNotify}
                onRestored={onRefresh}
              />
            </div>
          ) : null}

          <div>
            <h3 className="ui-title-caption">
              {t("fileDetailPanel.managementActions")}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {entryCanWrite(detailEntry) ? (
                <RenameInlineForm
                  fileEntryId={detailEntry.id}
                  currentName={detailEntry.name}
                  currentPath={detailEntry.relativePath}
                  onRefresh={onRefresh}
                  onNotify={onNotify}
                />
              ) : null}
              {entryCanWrite(detailEntry) ? (
                <MoveInlineForm
                  fileEntryId={detailEntry.id}
                  storageNodeId={detailEntry.storageNode.id}
                  name={detailEntry.name}
                  relativePath={detailEntry.relativePath}
                  onRefresh={onRefresh}
                  onNotify={onNotify}
                />
              ) : null}
              {canDelete && entryCanDelete(detailEntry) ? (
                <DeleteConfirmButton
                  fileEntryId={detailEntry.id}
                  entryName={detailEntry.name}
                  entryType={detailEntry.entryType as"FILE" |"DIRECTORY"}
                  onRefresh={onRefresh}
                  onNotify={onNotify}
                />
              ) : null}
            </div>
          </div>
        </div>
    </Dialog>
  );
}
