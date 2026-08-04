/**
 * Dynamic wrapper around `FileDetailPanel` (the right-side slide-over
 * panel that consolidates preview / download / share / media / rename
 * / move / delete actions for a single entry).
 *
 * TR-036 (T36b): The detail panel is only relevant when the user
 * clicks the "详情" inline button on a row. Routing it through
 * `next/dynamic` defers the `ShareFileButton` / `RenameInlineForm` /
 * `MoveInlineForm` / `DeleteConfirmButton` import graph (and their
 * sub-imports) until the user actually opens the panel.
 *
 * `ssr: false` is correct: the panel mounts conditionally and only
 * matters once an entry has been selected by the user. Pre-rendering
 * an empty shell buys nothing.
 *
 * Prop types via `ComponentProps<typeof import(...)>` — TS-only
 * construct that webpack does not follow, so the real component is
 * NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";
import { Spinner } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";

type FileDetailPanelProps = ComponentProps<
  typeof import("./file-detail-panel").FileDetailPanel
>;

function FileDetailPanelLoading() {
  const { t } = useI18n();
  const label = t("filesBrowserSpa.loading");
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--surface-subtle)] p-3 backdrop-blur-sm" role="presentation">
      <aside
        className="flex h-full w-full max-w-xl items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--modal-bg)] shadow-2xl"
        aria-live="polite"
      >
        <Spinner label={label} />
      </aside>
    </div>
  );
}

export const FileDetailPanelLazy: ComponentType<FileDetailPanelProps> =
  dynamic(
    () =>
      import("./file-detail-panel").then((m) => m.FileDetailPanel),
    { ssr: false, loading: FileDetailPanelLoading },
  );

export type { FileDetailPanelProps };
