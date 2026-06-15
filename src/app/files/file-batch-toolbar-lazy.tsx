/**
 * Dynamic wrapper around `FileBatchToolbar` (the fixed bottom toolbar
 * that hosts bulk delete / move actions once the user selects one or
 * more files).
 *
 * TR-036 (T36b): The batch toolbar is only relevant when
 * `selectedCount > 0`. Routing it through `next/dynamic` defers the
 * bundle that contains the `MoveInlineForm` / `DeleteConfirmButton`
 * sub-imports (and the form state machine wiring) until the user
 * actually clicks a row checkbox. The lazy chunk's stub matches the
 * real toolbar's outer chrome so the layout does not visibly shift
 * when the chunk arrives.
 *
 * Prop types via `ComponentProps<typeof import(...)>` — TS-only
 * construct that webpack does not follow, so the real component is
 * NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type FileBatchToolbarProps = ComponentProps<
  typeof import("./file-batch-toolbar").FileBatchToolbar
>;

export const FileBatchToolbarLazy: ComponentType<FileBatchToolbarProps> =
  dynamic(
    () =>
      import("./file-batch-toolbar").then((m) => m.FileBatchToolbar),
    { ssr: false },
  );

export type { FileBatchToolbarProps };
