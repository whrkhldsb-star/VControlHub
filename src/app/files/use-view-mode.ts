/**
 * View mode (list/grid/details) for the file browser, persisted to
 * localStorage so the user's choice survives page reloads.  Pure hook
 * — no JSX, fully unit-testable via renderHook.
 */

import { useCallback } from "react";

import { writeLocalStorageValue } from "@/lib/browser-storage";
import { useBrowserStorageSnapshot } from "@/lib/hooks/use-browser-storage-snapshot";

export type ViewMode = "list" | "grid" | "details";

export const VIEW_MODE_KEY = "app-file-view-mode";
const VALID: ReadonlySet<ViewMode> = new Set(["list", "grid", "details"]);
const DEFAULT_VIEW_MODE: ViewMode = "list";

function readPersistedViewMode(storage: Storage): ViewMode {
	const saved = storage.getItem(VIEW_MODE_KEY) as ViewMode | null;
	if (saved && VALID.has(saved)) return saved;
	return DEFAULT_VIEW_MODE;
}

/**
 * Returns the current view mode and a setter that also persists the value.
 *
 * The setter is wrapped in useCallback so consumers can pass it directly to
 * memoized children without invalidating their dependency array.
 */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
	const viewMode = useBrowserStorageSnapshot(VIEW_MODE_KEY, readPersistedViewMode, DEFAULT_VIEW_MODE);
	const set = useCallback((mode: ViewMode) => {
		writeLocalStorageValue(VIEW_MODE_KEY, mode);
	}, []);
	return [viewMode, set];
}
