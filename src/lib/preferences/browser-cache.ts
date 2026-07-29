"use client";

import { notifyLocalStorageChange } from "@/lib/browser-storage";
import {
	defaultUserPreferences,
	normalizeUserPreferences,
	type UserPreferences,
} from "./user-preferences";

export const USER_PREFERENCES_STORAGE_KEY = "vps-preferences";
export const USER_PREFERENCES_CHANGED_EVENT = "vps-preferences-updated";

export function readUserPreferencesCache(
	storage: Pick<Storage, "getItem"> = window.localStorage,
): UserPreferences | null {
	try {
		const raw = storage.getItem(USER_PREFERENCES_STORAGE_KEY);
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
	const storage = options.storage ?? window.localStorage;
	try {
		storage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
		if (options.notify !== false && typeof window !== "undefined") {
			notifyLocalStorageChange(USER_PREFERENCES_STORAGE_KEY);
			window.dispatchEvent(new Event(USER_PREFERENCES_CHANGED_EVENT));
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
