"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { logError } from "@/lib/logging";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";

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
  pagination?: {page:number;pageSize:number};
  sort?: "name" | "size" | "source" | "updated";
  direction?: "asc" | "desc";
};

export type FetchFilesOptions = {
  resetSelection?: boolean;
  history?: "push" | "replace" | "none";
  page?: number;
  pageSize?: number;
  sort?: "name" | "size" | "source" | "updated";
  direction?: "asc" | "desc";
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

  useEffect(() => () => {
    abortRef.current?.abort();
    // A transport may resolve despite cancellation; invalidate its history writes too.
    abortRef.current = null;
  }, []);

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
        const sameLocation = path === data.currentPath && (q ?? "") === data.searchQuery && (scope ?? "current") === data.searchScope && effectiveNodeId === data.nodeIdFilter;
        const page = options?.page ?? (sameLocation && !options?.resetSelection ? data.pagination?.page ?? 1 : 1);
        const pageSize = options?.pageSize ?? data.pagination?.pageSize;
        const sort = options?.sort ?? data.sort;
        const direction = options?.direction ?? data.direction;
        if (page > 1) params.set("page",String(page));
        if (pageSize) params.set("pageSize",String(pageSize));
        if (sort) params.set("sort",sort);
        if (direction) params.set("direction",direction);
        if (options?.page !== undefined || options?.pageSize !== undefined || options?.sort !== undefined) params.set("sync","0");

        const url = `/api/files/list${params.toString() ? `?${params.toString()}` : ""}`;
        const json = await csrfFetch<TData>(url, {
          signal: controller.signal,
        });
        // Aborted request lost the race — do not touch listing state.
        if (abortRef.current !== controller) return;
        const nextData = json;
        setData(nextData);
        if (shouldResetSelection) {
          setSelectionEpoch((current) => current + 1);
        }
        if (nextData.syncWarning) {
          setListError(nextData.syncWarning);
        }

        const newUrl = buildFilesPageUrl({
          path:nextData.currentPath,
          q:nextData.searchQuery,
          scope:nextData.searchScope,
          nodeId:nextData.nodeIdFilter,
          page:nextData.pagination?.page,
          pageSize:nextData.pagination?.pageSize,
          sort:nextData.sort,
          direction:nextData.direction,
        });
        if (historyMode === "push") {
          window.history.pushState(null, "", newUrl);
        } else if (historyMode === "replace") {
          window.history.replaceState(null, "", newUrl);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        // Stale abort race: a newer fetch owns loading.
        if (abortRef.current !== controller) return;
        logError("Failed to fetch files:", err);
        setListError(
          getErrorMessage(err, t("filesPage.listRefreshFailed")),
        );
      } finally {
        // Only the latest in-flight request may clear loading; aborted
        // predecessors must not flip loading false while a newer fetch runs.
        if (abortRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [data.nodeIdFilter, data.currentPath, data.searchQuery, data.searchScope, data.pagination, data.sort, data.direction, t],
  );

  // popstate: re-fetch from the URL without pushing a new history entry
  useEffect(() => {
    const handlePopState = () => {
      const next = getFilesStateFromLocation();
      setSearchInput(next.q);
      void fetchFiles(next.path, next.q, next.scope, next.nodeId, {
        resetSelection: true,
        history: "none",
        page:next.page,
        pageSize:next.pageSize,
        sort:next.sort,
        direction:next.direction,
      });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [fetchFiles]);

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
  page,
  pageSize,
  sort,
  direction,
}: {
  path: string;
  q?: string;
  scope?: string;
  nodeId?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  direction?: string;
}) {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (q) params.set("q", q);
  if (scope && scope !== "current") params.set("scope", scope);
  if (nodeId) params.set("nodeId", nodeId);
  if (page && page > 1) params.set("page",String(page));
  if (pageSize) params.set("pageSize",String(pageSize));
  if (sort) params.set("sort",sort);
  if (direction) params.set("direction",direction);
  const qs = params.toString();
  return qs ? `/files?${qs}` : "/files";
}

/**
 * Inverse of `buildFilesPageUrl`: read the current browser URL into
 * a `{ path, q, scope, nodeId }` snapshot.  Used to wire
 * back/forward navigation back into the listing hook.
 */
function getFilesStateFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return {
    path: params.get("path") ?? "",
    q: params.get("q") ?? "",
    scope: params.get("scope") === "all" ? "all" : "current",
    nodeId: params.get("nodeId") ?? "",
    page: Math.max(1,Number(params.get("page")) || 1),
    pageSize: Math.min(200,Math.max(1,Number(params.get("pageSize")) || 100)),
    sort: (["name","size","source","updated"].includes(params.get("sort") ?? "") ? params.get("sort") : "name") as "name" | "size" | "source" | "updated",
    direction: params.get("direction") === "desc" ? "desc" as const : "asc" as const,
  };
}
