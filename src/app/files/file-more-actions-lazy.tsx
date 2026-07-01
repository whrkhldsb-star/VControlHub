/**
 * Dynamic wrapper around `FileMoreActions` (the "更多" details/summary
 * dropdown that hosts secondary entry actions: share / rename / move /
 * delete).
 *
 * TR-036 (T36b): The "更多操作" menu is only opened when the user
 * actually expands the <details> summary, and most of the time the
 * menu sits collapsed. Routing the surrounding `details` markup through
 * `next/dynamic` defers the `ShareFileButton` / `RenameInlineForm` /
 * `MoveInlineForm` / `DeleteConfirmButton` import graph (and their
 * sub-imports) until the user actually expands a menu.
 *
 * The lazy chunk loads a small stub (an empty 8×8 button placeholder)
 * that matches the real component's outer chrome so the file-row action
 * bar does not visibly shift when the chunk arrives. The real menu
 * swaps in once the chunk finishes loading.
 *
 * Prop types via `ComponentProps<typeof import(...)>` — TS-only
 * construct that webpack does not follow, so the real component is
 * NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type FileMoreActionsProps = ComponentProps<
  typeof import("./file-more-actions").FileMoreActions
>;

function FileMoreActionsStub({ compact = false }: { compact?: boolean }) {
  return (
    <span
      aria-hidden
      className={
        compact
          ? "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)]/5 text-[var(--text-muted)]"
          : "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/5 px-2.5 py-1.5 text-xs text-[var(--text-muted)]"
      }
    >
      ⋯
    </span>
  );
}

export const FileMoreActionsLazy: ComponentType<FileMoreActionsProps> =
  dynamic(
    () =>
      import("./file-more-actions").then((m) => m.FileMoreActions),
    { ssr: false, loading: () => <FileMoreActionsStub /> },
  );

export type { FileMoreActionsProps };
