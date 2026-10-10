/**
 * Replace the current URL without adding a history entry, keeping the Next.js
 * router in sync. Next's patched replaceState treats a state object carrying
 * its `__NA`/`_N` markers as one of its own calls and skips recording the URL,
 * so a later `router.refresh()` restores the old URL and silently drops the
 * change (a settings tab hash, list filters). Dropping just those markers
 * keeps the rest of the state while Next re-adds its internals and adopts
 * the new URL.
 */
export function replaceBrowserUrl(url: string): void {
	const { __NA: _na, _N: _n, ...state } = (window.history.state ?? {}) as Record<string, unknown>;
	window.history.replaceState(state, "", url);
}
