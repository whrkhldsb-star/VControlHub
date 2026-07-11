/**
 * useImageBedList — image-bed page list state + fetch.
 * Encapsulates:
 *   - `images` / `total` / `page` / `totalPages` / `loading` (server-driven list)
 *   - `search` (text query, debounced via useEffect re-fetch on change)
 *   - `showAll` (toggle that scopes the query)
 *   - `fetchImages(p)` — fetches `/api/images/list` with pagination + filters
 *   - Auto-fetch on mount + whenever `search` or `showAll` change
 *
 * Behaviour 1:1 with the previous inline block in
 * `image-bed-page-client.tsx` — including the `setTimeout(..., 0)` initial
 * fetch trick that defers the first network call past React's first render.
 */
"use client";

import { useCallback, useEffect, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

import type { ImageItem } from "./image-bed-types";

const PAGE_SIZE = 30;

export interface UseImageBedListReturn {
	images: ImageItem[];
	total: number;
	page: number;
	totalPages: number;
	loading: boolean;
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
	const [loading, setLoading] = useState(false);
	const [showAll, setShowAll] = useState(false);

	const fetchImages = useCallback(async (p = 1) => {
		setLoading(true);
		try {
			const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
			if (search.trim()) params.set("q", search.trim());
			if (showAll) params.set("all", "true");
			const data = (await csrfFetch(`/api/images/list?${params}`, { cache: "no-store" })) as {
				images?: ImageItem[];
				total?: number;
				totalPages?: number;
			};
			setImages(data.images ?? []);
			setTotal(data.total ?? 0);
			setTotalPages(data.totalPages ?? 1);
			setPage(p);
		} catch {
			// Show-toast lives in the parent (depends on i18n copy + UI state).
			// We re-throw so the caller can decide how to surface the error.
			throw new Error("list-fetch-failed");
		} finally {
			setLoading(false);
		}
	}, [search, showAll]);

	// Initial fetch + re-fetch on filter changes.
	useEffect(() => {
		const timer = window.setTimeout(() => {
			void fetchImages(1).catch(() => {
				/* surface handled by parent */
			});
		}, 0);
		return () => window.clearTimeout(timer);
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
		search,
		showAll,
		fetchImages,
		setSearch,
		setShowAll,
	};
}
