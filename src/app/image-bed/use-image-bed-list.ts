/**
 * useImageBedList — image-bed page list state + fetch.
 * Encapsulates:
 *   - `images` / `total` / `page` / `totalPages` / `loading` (server-driven list)
 *   - `search` (text query, debounced re-fetch on change)
 *   - `showAll` (toggle that scopes the query)
 *   - `fetchImages(p)` — fetches `/api/images/list` with pagination + filters
 *   - Auto-fetch on mount + whenever `search` or `showAll` change
 *
 * Search is debounced (SEARCH_DEBOUNCE_MS) to avoid spamming `/api/images/list`
 * on every keystroke. `showAll` and initial mount still fetch promptly.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

import type { ImageItem } from "./image-bed-types";

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 300;

export interface UseImageBedListReturn {
	images: ImageItem[];
	total: number;
	page: number;
	totalPages: number;
	loading: boolean;
	/** Last list-fetch error message marker, or null when the latest fetch succeeded. */
	error: string | null;
	search: string;
	showAll: boolean;
	fetchImages: (p?: number) => Promise<void>;
	setSearch: (value: string) => void;
	setShowAll: (value: boolean) => void;
}

export function useImageBedList(opts: { canWrite: boolean }): UseImageBedListReturn {
	const [images, setImages] = useState<ImageItem[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showAll, setShowAll] = useState(false);
	const fetchGenRef = useRef(0);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setDebouncedSearch(search);
		}, SEARCH_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [search]);

	const fetchImages = useCallback(async (p = 1) => {
		const gen = ++fetchGenRef.current;
		setLoading(true);
		try {
			const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
			if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
			if (showAll) params.set("all", "true");
			const data = (await csrfFetch(`/api/images/list?${params}`, { cache: "no-store" })) as {
				images?: ImageItem[];
				total?: number;
				totalPages?: number;
			};
			// Ignore out-of-order responses from rapid search/showAll/page races.
			if (gen !== fetchGenRef.current) return;
			setImages(data.images ?? []);
			setTotal(data.total ?? 0);
			setTotalPages(data.totalPages ?? 1);
			setPage(p);
			setError(null);
		} catch {
			if (gen !== fetchGenRef.current) return;
			// Marker error so callers (and auto-fetch) can distinguish list failures.
			// Hook also exposes `error` so auto-fetch no longer needs a silent catch.
			setError("list-fetch-failed");
			throw new Error("list-fetch-failed");
		} finally {
			if (gen === fetchGenRef.current) setLoading(false);
		}
	}, [debouncedSearch, showAll]);

	// Initial fetch + re-fetch when debounced search or showAll changes.
	useEffect(() => {
		const timer = window.setTimeout(() => {
			void fetchImages(1).catch(() => {
				// error state already set inside fetchImages
			});
		}, 0);
		return () => {
			window.clearTimeout(timer);
			// Invalidate in-flight list so unmount/remount cannot apply stale state.
			fetchGenRef.current += 1;
		};
	}, [fetchImages]);

	// `canWrite` is currently unused inside the hook — reserved so the hook
	// can refuse to fetch on read-only contexts in the future without breaking
	// the call sites. Capture the reference to keep the dependency check
	// exhaustive (silences `react-hooks/exhaustive-deps`).
	void opts;

	return {
		images,
		total,
		page,
		totalPages,
		loading,
		error,
		search,
		showAll,
		fetchImages,
		setSearch,
		setShowAll,
	};
}
