"use client";

import { notifyLocalStorageChange } from "@/lib/browser-storage";
import {
	defaultUserPreferences,
	normalizeUserPreferences,
	type UserPreferences,
} from "./user-preferences";

import { PREFERENCES_EVENT, activePreferencesStorageKey } from "./cache-scope";
export { PREFERENCES_KEY as USER_PREFERENCES_STORAGE_KEY, PREFERENCES_EVENT as USER_PREFERENCES_CHANGED_EVENT } from "./cache-scope";

export function readUserPreferencesCache(
	storage?: Pick<Storage, "getItem">,
): UserPreferences | null {
	try {
		// Resolve the default inside the try so a non-browser environment
		// (SSR render path) degrades to null instead of throwing ReferenceError.
		const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
		if (!store) return null;
		const key = activePreferencesStorageKey(store);
		const raw = key && store.getItem(key);
		if (!raw) return null;
		return normalizeUserPreferences(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function writeUserPreferencesCache(
	value: unknown,
	options: {
		storage?: Pick<Storage, "getItem" | "setItem">;
		notify?: boolean;
	} = {},
): UserPreferences {
	const normalized = normalizeUserPreferences(value);
	try {
		// Inside the try: reading window.localStorage itself throws where
		// storage is blocked, and that must not look like a failed request.
		const storage = options.storage ?? (typeof window !== "undefined" ? window.localStorage : null);
		if (!storage) return normalized;
		const key = activePreferencesStorageKey(storage);
		if (!key) return normalized;
		storage.setItem(key, JSON.stringify(normalized));
		if (options.notify !== false && typeof window !== "undefined") {
			notifyLocalStorageChange(key);
			window.dispatchEvent(new Event(PREFERENCES_EVENT));
		}
	} catch {
		// The server remains authoritative when browser storage is unavailable.
	}
	return normalized;
}

export function mergeUserPreferencesCache(
	patch: Partial<UserPreferences>,
	options?: Parameters<typeof writeUserPreferencesCache>[1],
): UserPreferences {
	const current = readUserPreferencesCache(options?.storage) ?? defaultUserPreferences;
	return writeUserPreferencesCache({ ...current, ...patch }, options);
}
