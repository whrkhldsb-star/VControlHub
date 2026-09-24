import type { FileProp } from "./file-entry-utils";
import type { FolderProp } from "./file-list-model";

/**
 * Shared prop types for the four file-list view variants
 * (grid / details / list / list-mobile) and the row-action components.
 *
 * Every view used to re-declare `ToastFn` / `EntryGuard` / `FolderGuard` and a
 * ~15-field props bundle; they drifted apart once already. Declaring the
 * bundle once keeps the views' contracts in lock-step — a field added here
 * reaches all four views at once.
 */

/** Toast callback shared by every file-list view and action component. */
export type ToastFn = (type: "success" | "error" | "info", message: string) => void;

/** Per-entry capability predicate (grants come from the server payload). */
export type EntryGuard = (entry: { capabilities?: FileProp["capabilities"] }) => boolean;

/** Per-folder capability predicate. */
export type FolderGuard = (folder: FolderProp) => boolean;

/** Props common to every file-list view variant. */
export type FileListViewSharedProps = {
  sortedFolders: FolderProp[];
  sortedFiles: FileProp[];
  emptyMessage: string;
  parentPath?: string | null;
  onGoUp?: () => void;
  effectiveSelectedIdSet: Set<string>;
  toggleOne: (id: string) => void;
  navigateToFolder: (path: string) => void;
  canShare: boolean;
  canDelete: boolean;
  onRefresh?: () => void;
  onNotify: ToastFn;
  onOpenDetail: (id: string) => void;
  entryCanRead: EntryGuard;
  entryCanWrite: EntryGuard;
  entryCanDelete: EntryGuard;
};
