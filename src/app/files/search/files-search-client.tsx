"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/use-locale";
import { UnifiedFileSearch } from "../unified-file-search";
import { FilesSubpageNav } from "../files-subpage-nav";
import { PageShell, PageHeader, SurfacePanel } from "@/components/page-shell";
import { useRouter } from "next/navigation";

/**
 * Global file search subpage.
 * Filename search routes into the main browser with query params;
 * content search is handled in-place by UnifiedFileSearch.
 */
export function FilesSearchClient({
  nodes,
}: {
  nodes: Array<{ id: string; name: string; driver: string }>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");
  const [nodeId, setNodeId] = useState("");

  const onFilenameSearch = useCallback(
    (scope: "current" | "all") => {
      const q = searchInput.trim();
      if (!q) return;
      const params = new URLSearchParams({ q, scope });
      if (nodeId) params.set("nodeId", nodeId);
      router.push(`/files?${params.toString()}`);
    },
    [searchInput, nodeId, router],
  );

  return (
    <PageShell maxW="max-w-5xl">
      <PageHeader
        eyebrow={t("filesPage.eyebrow")}
        title={t("filesPage.subPage.search")}
        description={t("filesPage.subPage.searchDesc")}
      />
      <FilesSubpageNav />
      <SurfacePanel
        title={t("filesPage.subPage.search")}
        description={t("filesPage.subPage.searchPanelDesc")}
      >
        <div className="mb-4 grid gap-2 sm:max-w-sm">
          <label htmlFor="files-search-node" className="text-xs font-medium text-[var(--text-secondary)]">
            {t("filesPage.subPage.searchNodeFilter")}
          </label>
          <select
            id="files-search-node"
            value={nodeId}
            onChange={(e) => setNodeId(e.currentTarget.value)}
            className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm text-[var(--text-primary)]"
          >
            <option value="">{t("filesPage.subPage.searchAllNodes")}</option>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name} · {node.driver}
              </option>
            ))}
          </select>
        </div>
        <UnifiedFileSearch
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
          onFilenameSearch={onFilenameSearch}
          nodeId={nodeId || undefined}
        />
        <p className="mt-4 text-xs text-[var(--text-secondary)]">
          {t("filesPage.subPage.searchFilenameHint")}{" "}
          <Link href="/files" className="font-medium text-[var(--accent)] hover:underline">
            {t("filesPage.subNav.browser")}
          </Link>
        </p>
      </SurfacePanel>
    </PageShell>
  );
}
