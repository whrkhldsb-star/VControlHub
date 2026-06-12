/**
 * View mode (list/grid/details) for the file browser, persisted to
 * localStorage so the user's choice survives page reloads.  Pure hook
 * — no JSX, fully unit-testable via renderHook.
 */

import { useCallback, useState } from "react";

export type ViewMode = "list" | "grid" | "details";

export const VIEW_MODE_KEY = "app-file-view-mode";
const VALID: ReadonlySet<ViewMode> = new Set(["list", "grid", "details"]);
const DEFAULT_VIEW_MODE: ViewMode = "list";

function readPersistedViewMode(): ViewMode {
	try {
		const saved = localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
		if (saved && VALID.has(saved)) return saved;
	} catch {
		/* localStorage may be unavailable (SSR, private mode) */
	}
	return DEFAULT_VIEW_MODE;
}

function persistViewMode(mode: ViewMode): void {
	try {
		localStorage.setItem(VIEW_MODE_KEY, mode);
	} catch {
		/* ignore */
	}
}

/**
 * Returns the current view mode and a setter that also persists the value.
 *
 * The setter is wrapped in useCallback so consumers can pass it directly to
 * memoized children without invalidating their dependency array.
 */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
	const [viewMode, setViewMode] = useState<ViewMode>(readPersistedViewMode);
	const set = useCallback((mode: ViewMode) => {
		setViewMode(mode);
		persistViewMode(mode);
	}, []);
	return [viewMode, set];
}
