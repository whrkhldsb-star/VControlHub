"use client";

import { useI18n } from "@/lib/i18n/use-locale";

import { nodeKey, type TreeNode } from "./deployment-export-helpers";

type TreeProps = {
  tree: TreeNode[];
  activePath: string | null;
  onSelect: (path: string) => void;
};

export function DeploymentExportTree({ tree, activePath, onSelect }: TreeProps) {
  const { t } = useI18n();
  return (
    <div
      data-testid="deploy-export-tree"
      className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-3 font-mono text-xs text-[var(--text-secondary)]"
    >
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]/70">
        {t("deploymentsPage.export.fileTree")}
      </p>
      {tree.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{t("deploymentsPage.export.noFiles")}</p>
      ) : (
        <ul className="space-y-1">
          {tree.map((node) => (
            <TreeRow
              key={nodeKey(node)}
              node={node}
              depth={0}
              activePath={activePath}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  activePath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  const { t } = useI18n();
  if (!node.isFile) {
    return (
      <li>
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
          <span aria-hidden>📁</span>
          <span className="font-semibold text-[var(--text-secondary)]">{node.name || "/"}</span>
        </div>
        {node.children.length > 0 && (
          <ul className="mt-1 space-y-1">
            {node.children.map((child) => (
              <TreeRow
                key={nodeKey(child)}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const isActive = activePath === node.fullPath;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.fullPath)}
        data-testid={`deploy-export-file-${node.fullPath}`}
        className={`flex w-full items-center gap-1 rounded-lg px-1 py-0.5 text-left transition ${
          isActive
            ? "bg-[var(--color-action-bg)]/20 text-[var(--text-primary)]"
            : "hover:bg-[var(--surface-elevated)] text-[var(--text-secondary)]"
        }`}
        style={{ paddingLeft: depth * 12 }}
      >
        <span aria-hidden>📄</span>
        <span className="truncate">{node.name}</span>
        {isActive ? (
          <span className="ml-auto text-[10px] text-[var(--text-secondary)]">
            {t("deploymentsPage.export.viewing")}
          </span>
        ) : null}
      </button>
    </li>
  );
}
