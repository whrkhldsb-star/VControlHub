// Shared types for the storage server-action modules.
// Kept here (outside of any "use server" boundary) so every focused action
// module can import the action-state shape without a cross-module dependency.

export type StorageActionState = {
  error?: string;
  success?: string;
};
