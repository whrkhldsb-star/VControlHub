"use client";

/**
 * Module-level registry of active browser work that a customer-scope switch
 * (or deleting the active customer) will tear down when the root provider
 * remounts: dirty guarded forms, in-flight storage uploads, and open SSH/RDP
 * terminal tabs.
 *
 * Designed as an SSR-safe, provider-free store so any component or unit test
 * can mount `useUnsavedChangesGuard` or `CustomerSwitcher` without extra
 * wrappers, while surviving StrictMode and keyed provider remounts.
 */

export type ActiveWorkKind = "dirtyForm" | "upload" | "terminal";

export type ActiveWorkSnapshot = {
	dirtyForms: number;
	activeUploads: number;
	openTerminals: number;
	hasAny: boolean;
};

const buckets: Record<ActiveWorkKind, Map<symbol, number>> = {
	dirtyForm: new Map(),
	upload: new Map(),
	terminal: new Map(),
};

const listeners = new Set<() => void>();

let cachedSnapshot: ActiveWorkSnapshot = {
	dirtyForms: 0,
	activeUploads: 0,
	openTerminals: 0,
	hasAny: false,
};

function sum(map: Map<symbol, number>): number {
	let total = 0;
	for (const count of map.values()) total += count;
	return total;
}

function recompute() {
	const dirtyForms = sum(buckets.dirtyForm);
	const activeUploads = sum(buckets.upload);
	const openTerminals = sum(buckets.terminal);
	const hasAny = dirtyForms > 0 || activeUploads > 0 || openTerminals > 0;
	if (
		cachedSnapshot.dirtyForms === dirtyForms &&
		cachedSnapshot.activeUploads === activeUploads &&
		cachedSnapshot.openTerminals === openTerminals &&
		cachedSnapshot.hasAny === hasAny
	) {
		return;
	}
	cachedSnapshot = { dirtyForms, activeUploads, openTerminals, hasAny };
	for (const listener of listeners) listener();
}

/**
 * Register a positive active-work count and return its unregister callback.
 * Passing `0` or a negative count returns a no-op unregister.
 */
export function registerActiveWork(kind: ActiveWorkKind, count: number): () => void {
	if (count <= 0) return () => {};
	const token = Symbol(kind);
	buckets[kind].set(token, count);
	recompute();
	return () => {
		if (buckets[kind].delete(token)) recompute();
	};
}

export function getActiveWorkSnapshot(): ActiveWorkSnapshot {
	return cachedSnapshot;
}

export function subscribeActiveWork(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Coordinates confirmed customer-scope switches with `useUnsavedChangesGuard`
 * and `StorageUploadProvider` so an approved switch does not trigger a second
 * `beforeunload` prompt or a racing `window.history.back()` during remount.
 */
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let releasingScopeSwitch = false;

export function beginScopeSwitchRelease() {
	releasingScopeSwitch = true;
	if (releaseTimer !== null) {
		clearTimeout(releaseTimer);
		releaseTimer = null;
	}
}

/** Call when a switch request fails so guards immediately resume protection. */
export function endScopeSwitchRelease() {
	releasingScopeSwitch = false;
	if (releaseTimer !== null) {
		clearTimeout(releaseTimer);
		releaseTimer = null;
	}
}

/**
 * Call after a confirmed switch succeeds and triggers `router.refresh()`.
 * Keeps the release window open as a safety fallback until the incoming scope
 * mounts and calls `endScopeSwitchRelease()`.
 */
export function finishScopeSwitchRelease(delayMs = 5000) {
	if (releaseTimer !== null) clearTimeout(releaseTimer);
	releaseTimer = setTimeout(() => {
		releasingScopeSwitch = false;
		releaseTimer = null;
	}, delayMs);
}

export function isScopeSwitchReleasing(): boolean {
	return releasingScopeSwitch;
}

/**
 * Ref-count of mounted dirty `useUnsavedChangesGuard` hooks sharing the single
 * browser-history guard entry so saving one form does not call `history.back()`
 * while another hidden/sibling form is still dirty.
 */
let mountedDirtyHistoryGuards = 0;

export function acquireDirtyHistoryGuard(): number {
	mountedDirtyHistoryGuards += 1;
	return mountedDirtyHistoryGuards;
}

export function releaseDirtyHistoryGuard(): number {
	mountedDirtyHistoryGuards = Math.max(0, mountedDirtyHistoryGuards - 1);
	return mountedDirtyHistoryGuards;
}

/** Format a localized list of what a confirmed scope switch will tear down. */
export function formatActiveWorkSummary(
	snapshot: ActiveWorkSnapshot,
	t: (key: string, vars?: Record<string, string | number>) => string,
): string {
	const parts: string[] = [];
	if (snapshot.openTerminals > 0) {
		parts.push(t("nav.customerSwitchItem.terminals", { count: snapshot.openTerminals }));
	}
	if (snapshot.activeUploads > 0) {
		parts.push(t("nav.customerSwitchItem.uploads", { count: snapshot.activeUploads }));
	}
	if (snapshot.dirtyForms > 0) {
		parts.push(t("nav.customerSwitchItem.forms", { count: snapshot.dirtyForms }));
	}
	return parts.join(t("common.listSeparator"));
}

/** Test-only reset helper. */
export function resetActiveWorkRegistryForTests() {
	buckets.dirtyForm.clear();
	buckets.upload.clear();
	buckets.terminal.clear();
	endScopeSwitchRelease();
	mountedDirtyHistoryGuards = 0;
	recompute();
}
