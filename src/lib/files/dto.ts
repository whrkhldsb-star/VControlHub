/**
 * Files DTO boundary (TR-039).
 *
 * The `tree.ts` module owns the `FileTreeNode` runtime class (Map-backed
 * tree builder) plus the `buildFileTree` / `serializeFileTreeNode` /
 * `searchFileTree` helpers. Those helpers import from `@/lib/storage/service`
 * and the storage entry types are pure-data structs, but the runtime tree
 * itself is a `Map`-keyed in-memory structure that has no business being
 * pulled into a client component.
 *
 * The wire shapes produced by the file-tree serializers — the
 * `SerializedTreeNode` (recursive) and `SerializedTreeFolder` (leaf) — are
 * what the files browser and the file-listing API actually emit. They are
 * the contract that should be importable from a client bundle without
 * pulling in the storage service or the tree builder.
 *
 * `tree.ts` re-exports every type declared here so existing callers
 * `from "@/lib/files/tree"` keep working unchanged. New client code should
 * import the wire DTO types from this module.
 *
 * Pure types only — no runtime side effects, no Prisma, no DB.
 */

/**
 * Storage entry as it appears inside the file tree builder. The shape
 * matches the row returned by `listFileEntries`; we restate the fields
 * here so the tree module can be typed without pulling in
 * `@/lib/storage/service` at the type level.
 *
 * Field set is intentionally narrow: only the columns used by the tree
 * builder and its serialisers. Add fields only when the tree needs them.
 *
 * Required-vs-optional is mirrored from the real
 * `getStorageOverview().entries[number]` row: `directAccess` and
 * `localEditable` are always populated by the storage service, so they
 * stay required here. Optional fields are the ones that the prisma
 * column allows to be `null` (size, mimeType, etc.). The `entryType`
 * column is `FileEntryType NOT NULL` in the prisma schema, so the DTO
 * keeps it as a required `string`.
 *
 * The `size` field is `bigint | null` to match the prisma column type;
 * callers that need a `number` should call `BigInt#toString()` or
 * `Number(entry.size)` at the boundary. The `directAccess` field is
 * typed as a permissive structural shape that captures every
 * `DirectAccessResult` variant (managed-download / direct-url) without
 * pulling in the storage module at the type level.
 */
export type StorageEntryForTreeDto = {
  id: string;
  name: string;
  relativePath: string;
  storageNodeId: string;
  entryType: string;
  mimeType: string | null;
  size: bigint | null;
  checksumSha256: string | null;
  sizeLabel: string;
  previewable: boolean;
  localEditable: boolean;
  directAccess: {
    mode: string;
    description: string;
    href: string | null;
    fallbackHref?: string;
    publicBaseUrl?: string;
    expiresSeconds?: number;
  };
  storageNode: {
    id: string;
    name: string;
    driver: string;
    serverId?: string | null;
    server?: unknown;
  };
  updatedAt: string | Date | null;
};

/**
 * Directory summary as it appears inside the file tree builder. Comes from
 * `getStorageOverview().remoteDirectories`.
 */
export type StorageDirectoryForTreeDto = {
  path: string;
  storageNodeId: string;
  storageNodeName: string;
  storageNodeDriver: string;
};

/**
 * Recursive serialized tree node. This is the shape returned by
 * `serializeFileTreeNode` and emitted by the `/api/files/list` route and
 * the files browser SPA. It is safe to ship to the client because every
 * field is JSON-friendly (no `Map`, no `Date`).
 */
export type SerializedTreeNodeDto = {
  name: string;
  displayName?: string;
  path: string;
  entryId: string | null;
  storageNodeId: string | null;
  relativePath: string | null;
  fileCount: number;
  folderCount: number;
  sourceKeys: string[];
  sourceValues: string[];
  children: SerializedTreeNodeDto[];
};

/**
 * Single folder summary returned by `serializeFileTreeFolder` — the leaf
 * shape used by the files-browser sidebar. Same wire rules as
 * `SerializedTreeNodeDto` minus the `children` array.
 */
export type SerializedTreeFolderDto = {
  name: string;
  displayName?: string;
  path: string;
  entryId: string | null;
  storageNodeId: string | null;
  relativePath: string | null;
  fileCount: number;
  folderCount: number;
  sourceKeys: string[];
  sourceValues: string[];
};

/**
 * Wire shape for search results that have already been passed through
 * `serializeFileTreeFolder`. Most callers should run the serializer on
 * the runtime search output before shipping it across the
 * server↔client boundary; this alias exists so the client-side
 * import surface can be one symbol that matches what the
 * `searchFileTree` consumer will hand it.
 */
export type FileTreeSearchFoldersDto = SerializedTreeFolderDto[];
