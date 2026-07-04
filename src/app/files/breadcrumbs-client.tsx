"use client";

import {
  type NodeOption,
  splitPath,
  getDisplaySegment,
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

  return (
    <nav
      aria-label={t("filesBrowserSpa.breadcrumbAria")}
      className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]"
    >
      <button
        type="button"
        onClick={() => onNavigate("")}
        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface)]/10"
      >
        {t("filesBrowserSpa.allFiles")}
      </button>
      {segments.map((segment, index) => {
        const nextPath = segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        const displaySegment = getDisplaySegment(segment, nodes);
        return (
          <span key={nextPath} className="flex items-center gap-2">
            <span>/</span>
            {isLast ? (
              <span data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/30 px-3 py-1.5 text-[var(--text-primary)]">
                {displaySegment}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(nextPath)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface)]/10"
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
