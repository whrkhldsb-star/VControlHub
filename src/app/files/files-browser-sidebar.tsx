"use client";

import type { FilesApiResponse } from "./files-browser-helpers";
import { NodeFilterSelect } from "./node-filter-select";
import { FolderTreeClient } from "./folder-tree-client";

type TFn = (key: string) => string;

export function FilesBrowserSidebar({
  t,
  data,
  mobileSidebarOpen,
  expandedTreePaths,
  onToggleTreePath,
  onNodeFilterChange,
  onTreeNavigate,
}: {
  t: TFn;
  data: FilesApiResponse;
  mobileSidebarOpen: boolean;
  expandedTreePaths: Set<string>;
  onToggleTreePath: (path: string) => void;
  onNodeFilterChange: (nodeId: string) => void;
  onTreeNavigate: (path: string) => void;
}) {
  return (
    <aside
      id="files-browser-sidebar"
      aria-label={t("filesBrowserSpa.sidebarAria")}
      className={`w-full min-w-0 self-start rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] xl:sticky xl:top-4 ${
        mobileSidebarOpen ? "block" : "hidden xl:block"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {t("filesBrowserSpa.directoryTree")}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
            {t("filesBrowserSpa.hierarchyDescription")}
          </p>
        </div>
      </div>

      {data.nodes.length > 1 ? (
        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-secondary)]">
            {t("filesBrowserSpa.filterByNode")}
          </label>
          <NodeFilterSelect
            t={t}
            nodes={data.nodes}
            value={data.nodeIdFilter}
            onChange={onNodeFilterChange}
            compact
          />
        </div>
      ) : null}

      <div className="mt-4 max-h-[28rem] overflow-x-auto overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3 pr-2">
        <button
          type="button"
          onClick={() => onTreeNavigate("")}
          className={`flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
            data.currentPath === ""
              ? "bg-[var(--accent-bg)] font-medium text-[var(--accent)] shadow-[var(--shadow-sm)]"
              : "text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
          }`}
        >
          <span>{t("filesBrowserSpa.allFiles")}</span>
          <span className="text-xs text-[var(--text-muted)]">{data.stats.totalEntries}</span>
        </button>
        {data.tree.children && data.tree.children.length > 0 ? (
          <FolderTreeClient
            t={t}
            node={data.tree}
            currentPath={data.currentPath}
            onNavigate={onTreeNavigate}
            expandedPaths={expandedTreePaths}
            onToggle={onToggleTreePath}
          />
        ) : null}
      </div>
    </aside>
  );
}
