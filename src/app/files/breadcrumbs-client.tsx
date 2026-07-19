"use client";

import {
  type NodeOption,
  splitPath,
  getDisplaySegment,
  getParentPath,
} from "./files-browser-helpers";

/* ── Breadcrumbs (client-side, SPA) ─────────────────────────────── */

export function BreadcrumbsClient({
  t,
  path,
  nodes,
  onNavigate,
}: {
  t: (k: string) => string;
  path: string;
  nodes: NodeOption[];
  onNavigate: (path: string) => void;
}) {
  const segments = splitPath(path);
  const parentPath = getParentPath(path);

  return (
    <nav
      aria-label={t("filesBrowserSpa.breadcrumbAria")}
      className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]"
    >
      {parentPath !== null ? (
        <button
          type="button"
          onClick={() => onNavigate(parentPath)}
          data-testid="files-up-level"
          data-action-button
          data-variant="secondary"
          className="!inline-flex !items-center !gap-1.5 !px-3 !py-1.5 !text-sm !font-medium"
          title={t("filesBrowserSpa.upLevel")}
        >
          <span aria-hidden="true">↑</span>
          {t("filesBrowserSpa.upLevel")}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onNavigate("")}
        data-action-button
        data-variant="ghost"
        className="!px-3 !py-1.5 !text-sm"
      >
        {t("filesBrowserSpa.allFiles")}
      </button>
      {segments.map((segment, index) => {
        const nextPath = segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        const displaySegment = getDisplaySegment(segment, nodes);
        return (
          <span key={nextPath} className="flex items-center gap-2">
            <span className="text-[var(--text-muted)]">/</span>
            {isLast ? (
              <span
                data-tone="cyan"
                className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
              >
                {displaySegment}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(nextPath)}
                data-action-button
                data-variant="ghost"
                className="!px-3 !py-1.5 !text-sm"
              >
                {displaySegment}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
