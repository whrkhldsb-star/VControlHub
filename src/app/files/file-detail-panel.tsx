"use client";

/**
 * FileDetailPanel — the right-hand drawer for one file: a large preview,
 * the common actions, its properties and version history. Changes (rename,
 * move, share, delete…) open the same dialogs as the row menu.
 *
 * Loaded through `FileDetailPanelLazy`, so the version history and its
 * request code stay out of the page bundle until a drawer opens.
 */
import { useI18n } from "@/lib/i18n/use-locale";
import { Dialog } from "@/components/ui/dialog";
import { KeyValueList } from "@/components/ui/key-value";
import { ActionButton, ButtonLink } from "@/components/action-button";
import { Copy, Download, Eye, FolderInput, ImageIcon, LinkIcon, Pencil, Star, Trash2 } from "@/components/icons";
import { getStorageAccessLabel, getStorageDriverLabel } from "@/lib/i18n/domain-labels";
import {
  buildForcedDownloadHref,
  buildMediaLibraryHref,
  formatDate,
  getPreviewHref,
  getThumbnailUrl,
  type StorageEntry,
} from "./file-entry-utils";
import { FileVersionHistoryPanel } from "./file-version-history-panel";
import { useFileActions, type FileActionTarget } from "./file-actions";
import { EntryThumb, type DriveRow } from "./file-list-views";

export type FileDetailPanelProps = {
  detailEntry: StorageEntry;
  favorite?: boolean;
  onClose: () => void;
  canShare: boolean;
  canDelete: boolean;
  onRefresh?: () => void;
  onNotify: (type: "success" | "error" | "info", message: string) => void;
  // read/write/delete capability checks. The parent supplies these so
  // this chunk doesn't have to re-import the model layer (which would
  // defeat the lazy-load goal).
  entryCanRead: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
  entryCanWrite: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
  entryCanDelete: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
};

export function FileDetailPanel({
  detailEntry,
  favorite = false,
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
  const actions = useFileActions();
  const canRead = entryCanRead(detailEntry);
  const canWrite = entryCanWrite(detailEntry);
  const mayDelete = canDelete && entryCanDelete(detailEntry);
  const target: FileActionTarget = {
    id: detailEntry.id,
    name: detailEntry.name,
    entryType: detailEntry.entryType === "DIRECTORY" ? "DIRECTORY" : "FILE",
    relativePath: detailEntry.relativePath,
    storageNodeId: detailEntry.storageNode.id,
    storageNodeName: detailEntry.storageNode.name,
    favorite,
  };
  // The drawer closes before a dialog opens, so the two never stack.
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const preview: DriveRow = {
    key: detailEntry.id,
    kind: "file",
    id: detailEntry.id,
    name: detailEntry.name,
    sizeLabel: detailEntry.sizeLabel,
    modifiedLabel: "",
    favorite,
    icon: { entryType: detailEntry.entryType, mimeType: detailEntry.mimeType, name: detailEntry.name },
    thumbUrl: canRead ? getThumbnailUrl(detailEntry) : null,
    openHref: null,
    onOpen: () => undefined,
    selectable: false,
    selected: false,
    draggable: false,
    menu: { kind: "file", target: null, canRead: false, canWrite: false, canDelete: false, canShare: false },
  };

  return (
    <Dialog
      size="xl"
      placement="drawer"
      open
      onClose={onClose}
      eyebrow={t("common.fileDetails")}
      title={detailEntry.name}
      description={<span className="ui-mono break-all">/{detailEntry.relativePath}</span>}
      closeLabel={t("fileDetailPanel.close")}
    >
      <div className="flex flex-col gap-5">
        <div data-inset className="grid aspect-[16/9] place-items-center overflow-hidden p-3">
          {/* The thumbnail is at most 320px: show it at that size rather than stretch it. */}
          <EntryThumb row={preview} size={88} fit="contain" />
        </div>

        <div className="flex flex-wrap gap-2">
          {detailEntry.previewable && canRead ? (
            <ButtonLink href={getPreviewHref(detailEntry)} variant="primary" icon={<Eye aria-hidden />}>
              {t("fileDetailPanel.preview")}
            </ButtonLink>
          ) : null}
          {canRead ? (
            <a href={buildForcedDownloadHref(detailEntry)} download data-action-button="" data-variant="secondary" data-size="md">
              <Download aria-hidden />
              <span>{t("fileDetailPanel.download")}</span>
            </a>
          ) : null}
          {canShare && canRead && detailEntry.entryType === "FILE" ? (
            <ActionButton variant="secondary" icon={<LinkIcon aria-hidden />} onClick={run(() => actions.share(target))}>
              {t("sharesPage.button.compact")}
            </ActionButton>
          ) : null}
          {canRead ? (
            <ActionButton variant="secondary" icon={<Star aria-hidden fill={favorite ? "currentColor" : "none"} />} onClick={() => void actions.toggleFavorite(target).then(onClose)}>
              {t(favorite ? "filesPage.drive.unfavorite" : "filesPage.drive.favorite")}
            </ActionButton>
          ) : null}
        </div>

        <KeyValueList
          columns={2}
          items={[
            { label: t("fileDetailPanel.size"), value: detailEntry.sizeLabel },
            { label: t("fileDetailPanel.modified"), value: detailEntry.updatedAt ? formatDate(detailEntry.updatedAt, locale) : null },
            { label: t("fileDetailPanel.storageNode"), value: detailEntry.storageNode.name },
            { label: t("fileDetailPanel.driver"), value: getStorageDriverLabel(t, detailEntry.storageNode.driver) },
            { label: t("filesPage.drive.fileType"), value: detailEntry.mimeType || null },
            { label: t("fileDetailPanel.accessMode"), value: getStorageAccessLabel(t, detailEntry.storageNode.driver, detailEntry.directAccess.mode), wide: true },
          ]}
        />

        {canWrite || mayDelete || canRead ? (
          <div>
            <h3 className="ui-title-caption">{t("fileDetailPanel.managementActions")}</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {canWrite ? (
                <ActionButton size="sm" variant="secondary" icon={<Pencil aria-hidden />} onClick={run(() => actions.rename(target))}>
                  {t("renameInlineForm.rename")}
                </ActionButton>
              ) : null}
              {canWrite ? (
                <ActionButton size="sm" variant="secondary" icon={<FolderInput aria-hidden />} onClick={run(() => actions.move([target]))}>
                  {t("filesPage.drive.moveToEllipsis")}
                </ActionButton>
              ) : null}
              {canWrite && canRead ? (
                <ActionButton size="sm" variant="secondary" icon={<Copy aria-hidden />} onClick={run(() => actions.copy([target]))}>
                  {t("filesPage.drive.copyToEllipsis")}
                </ActionButton>
              ) : null}
              {canRead ? (
                <ButtonLink size="sm" variant="secondary" href={buildMediaLibraryHref(detailEntry)} icon={<ImageIcon aria-hidden />}>
                  {t("fileDetailPanel.findInMedia")}
                </ButtonLink>
              ) : null}
              {mayDelete ? (
                <ActionButton size="sm" variant="danger" icon={<Trash2 aria-hidden />} onClick={run(() => actions.remove([target]))}>
                  {t("common.delete")}
                </ActionButton>
              ) : null}
            </div>
          </div>
        ) : null}

        {detailEntry.entryType === "FILE" && canRead ? (
          <div className="border-t border-[var(--border)] pt-5">
            <FileVersionHistoryPanel
              fileEntryId={detailEntry.id}
              canWrite={canWrite}
              onNotify={onNotify}
              onRestored={onRefresh}
            />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
