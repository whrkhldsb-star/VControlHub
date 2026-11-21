export const PREFERENCES_KEY = "vps-preferences";
export const PREFERENCES_EVENT = "vps-preferences-updated";
export const ACTIVE_PREFERENCES_KEY = "vch:preferences-active-user";

export function preferencesStorageKey(userId = typeof document === "undefined" ? undefined : document.documentElement.dataset.preferencesUser) {
  // A standalone consumer may supply its own storage without a document. The
  // app layout always sets the attribute, including an empty value at logout.
  return userId === undefined ? PREFERENCES_KEY : PREFERENCES_KEY + ":" + encodeURIComponent(userId);
}

/** A tab with an old session must not repopulate its cache after another tab signs in. */
export function activePreferencesStorageKey(storage: Pick<Storage, "getItem">) {
  const key = preferencesStorageKey();
  if (key === PREFERENCES_KEY) return key;
  const active = storage.getItem(ACTIVE_PREFERENCES_KEY);
  return active === null || active === key ? key : null;
}
