export const LOCAL_STORAGE_SYNC_EVENT = "vch:local-storage-sync";

export function notifyLocalStorageChange(key: string): void {
	window.dispatchEvent(new CustomEvent(LOCAL_STORAGE_SYNC_EVENT, { detail: key }));
}

export function writeLocalStorageValue(key: string, value: string): boolean {
	try {
		window.localStorage.setItem(key, value);
		notifyLocalStorageChange(key);
		return true;
	} catch {
		// Storage can be unavailable in private or restricted browser contexts.
		return false;
	}
}
