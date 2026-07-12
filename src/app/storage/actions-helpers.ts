// Shared types for the storage server-action modules.
// Kept here (outside of any "use server" boundary) so every focused action
// module can import the action-state shape without a cross-module dependency.

export type StorageActionState = {
  error?: string;
  success?: string;
};

/** Soft-delete result fields used by deleteFileEntryAction only. */
export type StorageDeleteActionState = StorageActionState & {
  /** Soft-delete: whether the physical object was removed. */
  physicalDeleted?: boolean;
  /** Soft-delete: index updated but physical object still present / failed. */
  needsReconcile?: boolean;
};
