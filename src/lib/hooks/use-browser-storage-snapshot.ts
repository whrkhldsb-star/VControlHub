"use client";

import { useCallback, useSyncExternalStore } from "react";
import { LOCAL_STORAGE_SYNC_EVENT } from "@/lib/browser-storage";

type StableSnapshot = string | number | boolean | null | undefined;

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
