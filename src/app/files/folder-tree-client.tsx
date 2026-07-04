"use client";

import type { TreeRootNode } from "./files-browser-helpers";

/* ── FolderTree (client-side, SPA) ──────────────────────────────── */

export function FolderTreeClient({
  t,
  node,
  currentPath,
  onNavigate,
  expandedPaths,
  onToggle,
  depth = 0,
}: {
  t: (k: string) => string;
  node: TreeRootNode;
  currentPath: string;
  onNavigate: (path: string) => void;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  depth?: number;
}) {
  const children = node.children;
  if (!children || children.length === 0) return null;

  return (
    <ul
      className={
        depth === 0
          ? "mt-3 space-y-1"
          : "mt-1 space-y-1 border-l border-[var(--border)] pl-3"
      }
    >
      {children.map((child) => {
        const isCurrent = child.path === currentPath;
        const hasChildren = Boolean(child.children?.length);
        const isExpanded = expandedPaths.has(child.path);

        return (
          <li key={child.path || child.name}>
            <div
              className={`flex items-center gap-1 rounded-2xl transition ${
                isCurrent
                  ? "bg-[var(--color-action-bg)]/10 text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface)]/10 hover:text-[var(--text-primary)]"
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  hasChildren ? onToggle(child.path) : onNavigate(child.path)
                }
                aria-label={
                  hasChildren
                    ? `${isExpanded ? t("filesBrowserSpa.collapseNode") : t("filesBrowserSpa.expandNode")} ${child.displayName ?? child.name}`
                    : t("filesBrowserSpa.openChild").replace("{name}", child.displayName ?? child.name)
                }
                aria-expanded={hasChildren ? isExpanded : undefined}
                className="grid h-8 w-8 flex-none place-items-center rounded-xl text-xs text-[var(--text-secondary)] hover:bg-[var(--surface)]/10 hover:text-[var(--text-primary)] light:hover:text-[var(--text-primary)]"
              >
                {hasChildren ? (isExpanded ? "▾" : "▸") : "•"}
              </button>
              <button
                type="button"
                onClick={() => onNavigate(child.path)}
                aria-current={isCurrent ? "page" : undefined}
                aria-label={child.name}
                className="flex min-w-0 flex-1 items-center justify-between px-2 py-2 text-left text-sm"
              >
                <span className="truncate" title={child.displayName ?? child.name}>
                  📁 {child.displayName ?? child.name}
                </span>
                <span
                  aria-hidden="true"
                  className="ml-3 flex-none text-xs text-[var(--text-muted)]"
                >
                  {child.fileCount + child.folderCount}
                </span>
              </button>
            </div>
            {hasChildren && isExpanded ? (
              <FolderTreeClient
                t={t}
                node={child}
                currentPath={currentPath}
                onNavigate={onNavigate}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                depth={depth + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
