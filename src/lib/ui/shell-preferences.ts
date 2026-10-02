"use client";

/**
 * Per-browser shell preferences: collapsed sidebar, pinned pages, open nav
 * groups and recently visited pages. Stored in localStorage (the collapsed
 * state also in a cookie so the server renders the right width); every
 * storage access tolerates private mode and disabled storage.
 */
import { useCallback, useSyncExternalStore } from "react";

const PINS_KEY = "vch:nav-pins";
const GROUPS_KEY = "vch:nav-groups";
const RECENT_KEY = "vch:recent-pages";
export const SIDEBAR_COOKIE = "vch-sidebar";
const CHANGE_EVENT = "vch:shell-preferences";
const RECENT_LIMIT = 6;

function readJson<T>(key: string, fallback: T): T {
	try {
		const raw = window.localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function writeJson(key: string, value: unknown) {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage unavailable: the preference lasts for this page only.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void) {
	window.addEventListener(CHANGE_EVENT, callback);
	window.addEventListener("storage", callback);
	return () => {
		window.removeEventListener(CHANGE_EVENT, callback);
		window.removeEventListener("storage", callback);
	};
}

/* Snapshots must be referentially stable between reads of the same value. */
const snapshotCache = new Map<string, { raw: string | null; value: unknown }>();
function cachedSnapshot<T>(key: string, fallback: T): T {
	let raw: string | null = null;
	try {
		raw = window.localStorage.getItem(key);
	} catch {
		raw = null;
	}
	const cached = snapshotCache.get(key);
	if (cached && cached.raw === raw) return cached.value as T;
	let value: T = fallback;
	try {
		value = raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		value = fallback;
	}
	snapshotCache.set(key, { raw, value });
	return value;
}

const EMPTY_LIST: string[] = [];
const EMPTY_MAP: Record<string, boolean> = {};

/* ── Pinned pages ─────────────────────────────────────────────────────── */

export function useNavPins() {
	const pins = useSyncExternalStore(subscribe, () => cachedSnapshot<string[]>(PINS_KEY, EMPTY_LIST), () => EMPTY_LIST);
	const toggle = useCallback((href: string) => {
		const current = readJson<string[]>(PINS_KEY, []);
		writeJson(PINS_KEY, current.includes(href) ? current.filter((entry) => entry !== href) : [...current, href]);
	}, []);
	return { pins: Array.isArray(pins) ? pins : EMPTY_LIST, toggle };
}

/* ── Open navigation groups ───────────────────────────────────────────── */

export function useNavGroupState() {
	const groups = useSyncExternalStore(subscribe, () => cachedSnapshot<Record<string, boolean>>(GROUPS_KEY, EMPTY_MAP), () => EMPTY_MAP);
	const setOpen = useCallback((id: string, open: boolean) => {
		writeJson(GROUPS_KEY, { ...readJson<Record<string, boolean>>(GROUPS_KEY, {}), [id]: open });
	}, []);
	return { groups: groups && typeof groups === "object" ? groups : EMPTY_MAP, setOpen };
}

/* ── Recently visited pages ───────────────────────────────────────────── */

export function recordRecentPage(href: string) {
	const current = readJson<string[]>(RECENT_KEY, []);
	if (current[0] === href) return;
	writeJson(RECENT_KEY, [href, ...current.filter((entry) => entry !== href)].slice(0, RECENT_LIMIT));
}

export function useRecentPages() {
	const recent = useSyncExternalStore(subscribe, () => cachedSnapshot<string[]>(RECENT_KEY, EMPTY_LIST), () => EMPTY_LIST);
	return Array.isArray(recent) ? recent : EMPTY_LIST;
}

/* ── Collapsed sidebar ────────────────────────────────────────────────── */

function readCollapsed() {
	return typeof document !== "undefined" && document.documentElement.dataset.sidebar === "collapsed";
}

export function setSidebarCollapsed(collapsed: boolean) {
	document.documentElement.dataset.sidebar = collapsed ? "collapsed" : "expanded";
	const secure = window.location.protocol === "https:" ? "; secure" : "";
	document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax${secure}`;
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function toggleSidebarCollapsed() {
	setSidebarCollapsed(!readCollapsed());
}

export function useSidebarCollapsed() {
	return useSyncExternalStore(subscribe, readCollapsed, () => false);
}
