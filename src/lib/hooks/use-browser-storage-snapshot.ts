"use client";

import { useCallback, useSyncExternalStore } from "react";

type StableSnapshot = string | number | boolean | null | undefined;

const LOCAL_STORAGE_SYNC_EVENT = "vch:local-storage-sync";

export function notifyLocalStorageChange(key: string): void {
	window.dispatchEvent(new CustomEvent(LOCAL_STORAGE_SYNC_EVENT, { detail: key }));
}

export function writeLocalStorageValue(key: string, value: string): void {
	try {
		window.localStorage.setItem(key, value);
		notifyLocalStorageChange(key);
	} catch {
		// Storage can be unavailable in private or restricted browser contexts.
	}
}

export function useBrowserStorageSnapshot<T extends StableSnapshot>(
	key: string,
	read: (storage: Storage) => T,
	serverSnapshot: T,
	extraEventName?: string,
): T {
	const subscribe = useCallback((onStoreChange: () => void) => {
		const onStorage = (event: Event) => {
			const changedKey = (event as StorageEvent).key;
			if (changedKey === null || changedKey === undefined || changedKey === key) onStoreChange();
		};
		const onLocalSync = (event: Event) => {
			if ((event as CustomEvent<string>).detail === key) onStoreChange();
		};

		window.addEventListener("storage", onStorage);
		window.addEventListener(LOCAL_STORAGE_SYNC_EVENT, onLocalSync);
		if (extraEventName) window.addEventListener(extraEventName, onStoreChange);
		return () => {
			window.removeEventListener("storage", onStorage);
			window.removeEventListener(LOCAL_STORAGE_SYNC_EVENT, onLocalSync);
			if (extraEventName) window.removeEventListener(extraEventName, onStoreChange);
		};
	}, [extraEventName, key]);

	const getSnapshot = useCallback(() => {
		try {
			return read(window.localStorage);
		} catch {
			return serverSnapshot;
		}
	}, [read, serverSnapshot]);
	const getServerSnapshot = useCallback(() => serverSnapshot, [serverSnapshot]);

	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
