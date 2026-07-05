"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { logError } from "@/lib/logging";
import { useI18n } from "@/lib/i18n/use-locale";

/**
 * Minimal shape of the `/api/files/list` response that the listing
 * hook actually reads.  The page-level SPA passes its own richer
 * `FilesApiResponse` type as a generic so the hook stays free of
 * concrete fields (entries, totals, …) it does not touch.
 */
export type ListingFilesApiResponse = {
  currentPath: string;
  nodeIdFilter: string;
  searchQuery: string;
  searchScope: string;
  syncWarning?: string | null;
};

export type FetchFilesOptions = {
  resetSelection?: boolean;
  history?: "push" | "replace" | "none";
};

export type FetchFilesFn = (
  path: string,
  q?: string,
  scope?: string,
  nodeId?: string,
  options?: FetchFilesOptions,
) => Promise<void>;

export type UseFileBrowserListingInput<TData extends ListingFilesApiResponse> = {
  initialData: TData;
  // Set this to true on the component that owns the mobile sidebar
  // toggle. The hook will then expose `mobileSidebarOpen` /
  // `setMobileSidebarOpen` so the page can render the open/close
  // button and the hook can still react to listing state.
  manageMobileSidebar?: boolean;
};

export type UseFileBrowserListingResult<TData extends ListingFilesApiResponse> = {
  data: TData;
  loading: boolean;
  listError: string | null;
  selectionEpoch: number;
  searchInput: string;
  setSearchInput: (value: string) => void;
  fetchFiles: FetchFilesFn;
  handleSearch: (e: React.FormEvent) => void;
  handleScopeChange: (newScope: string) => void;
  // Only present when `manageMobileSidebar` is true. The mobile
  // sidebar is rendered by the page, not by the hook, but the
  // auto-collapse behaviour depends on a recent fetch.
  mobileSidebarOpen?: boolean;
  setMobileSidebarOpen?: (value: boolean) => void;
};

/**
 * Listing state for the file browser SPA: the current `data` snapshot,
 * loading / error flags, the search input, the selection-reset
 * `selectionEpoch`, an `AbortController` that cancels in-flight
 * requests when the user navigates quickly, and the two handlers
 * (`handleSearch`, `handleScopeChange`) that the toolbar wires up.
 *
 * The hook also listens for `popstate` and re-fetches with
 * `history: "none"` so the back/forward buttons stay in sync without
 * pushing new history entries.
 */
export function useFileBrowserListing<TData extends ListingFilesApiResponse>({
  initialData,
  manageMobileSidebar = false,
}: UseFileBrowserListingInput<TData>): UseFileBrowserListingResult<TData> {
  const { t } = useI18n();
  const [data, setData] = useState<TData>(initialData);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const [searchInput, setSearchInput] = useState(initialData.searchQuery);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchFiles = useCallback<FetchFilesFn>(
    async (path, q, scope, nodeId, options) => {
      // Cancel previous request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const shouldResetSelection = options?.resetSelection ?? false;
      const historyMode = options?.history ?? "replace";

      setLoading(true);
      setListError(null);
      try {
        const params = new URLSearchParams();
        if (path) params.set("path", path);
        if (q) params.set("q", q);
        if (scope && scope !== "current") params.set("scope", scope);
        const effectiveNodeId = nodeId ?? data.nodeIdFilter;
        if (effectiveNodeId) params.set("nodeId", effectiveNodeId);

        const url = `/api/files/list${params.toString() ? `?${params.toString()}` : ""}`;
        const json = await csrfFetch<TData>(url, {
          signal: controller.signal,
        });
        const nextData = json;
        setData(nextData);
        if (shouldResetSelection) {
          setSelectionEpoch((current) => current + 1);
        }
        if (nextData.syncWarning) {
          setListError(nextData.syncWarning);
        }

        const newUrl = buildFilesPageUrl({
          path,
          q,
          scope,
          nodeId: effectiveNodeId,
        });
        if (historyMode === "push") {
          window.history.pushState(null, "", newUrl);
        } else if (historyMode === "replace") {
          window.history.replaceState(null, "", newUrl);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        logError("Failed to fetch files:", err);
        setListError(
          err instanceof Error ? err.message : t("filesPage.listRefreshFailed"),
        );
      } finally {
        setLoading(false);
      }
    },
    [data.nodeIdFilter, t],
  );

  // popstate: re-fetch from the URL without pushing a new history entry
  useEffect(() => {
    const handlePopState = () => {
      const next = getFilesStateFromLocation(initialData.nodeIdFilter);
      setSearchInput(next.q);
      void fetchFiles(next.path, next.q, next.scope, next.nodeId, {
        resetSelection: true,
        history: "none",
      });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [fetchFiles, initialData.nodeIdFilter]);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void fetchFiles(
        data.currentPath,
        searchInput,
        data.searchScope,
        data.nodeIdFilter,
        { resetSelection: true },
      );
    },
    [fetchFiles, data.currentPath, searchInput, data.searchScope, data.nodeIdFilter],
  );

  const handleScopeChange = useCallback(
    (newScope: string) => {
      void fetchFiles(
        data.currentPath,
        data.searchQuery,
        newScope,
        data.nodeIdFilter,
        { resetSelection: true },
      );
    },
    [fetchFiles, data.currentPath, data.searchQuery, data.nodeIdFilter],
  );

  return {
    data,
    loading,
    listError,
    selectionEpoch,
    searchInput,
    setSearchInput,
    fetchFiles,
    handleSearch,
    handleScopeChange,
    ...(manageMobileSidebar
      ? { mobileSidebarOpen, setMobileSidebarOpen }
      : {}),
  };
}

/**
 * Build a `/files?…` URL from the active listing state so the
 * browser bar reflects the current folder / query / scope / node.
 */
function buildFilesPageUrl({
  path,
  q,
  scope,
  nodeId,
}: {
  path: string;
  q?: string;
  scope?: string;
  nodeId?: string;
}) {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (q) params.set("q", q);
  if (scope && scope !== "current") params.set("scope", scope);
  if (nodeId) params.set("nodeId", nodeId);
  const qs = params.toString();
  return qs ? `/files?${qs}` : "/files";
}

/**
 * Inverse of `buildFilesPageUrl`: read the current browser URL into
 * a `{ path, q, scope, nodeId }` snapshot.  Used to wire
 * back/forward navigation back into the listing hook.
 */
function getFilesStateFromLocation(defaultNodeId: string) {
  const params = new URLSearchParams(window.location.search);
  return {
    path: params.get("path") ?? "",
    q: params.get("q") ?? "",
    scope: params.get("scope") === "all" ? "all" : "current",
    nodeId: params.get("nodeId") ?? defaultNodeId,
  };
}
