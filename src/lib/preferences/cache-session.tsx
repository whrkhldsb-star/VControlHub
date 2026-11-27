"use client";

import { useEffect } from "react";
import { writeUserPreferencesCache } from "./browser-cache";
import { ACTIVE_PREFERENCES_KEY, PREFERENCES_EVENT, PREFERENCES_KEY, preferencesStorageKey } from "./cache-scope";
import { clearShellPreferences } from "@/lib/ui/shell-preferences";

/** Initialise the signed-in account even when the first page is a polling dashboard. */
export function PreferenceCacheSession({ userId }: { userId: string | null }) {
  useEffect(() => {
    const key = preferencesStorageKey(userId ?? "");
    const controller = new AbortController();
    try {
      const store = window.localStorage;
      const previous = store.getItem(ACTIVE_PREFERENCES_KEY);
      if (previous?.startsWith(PREFERENCES_KEY + ":") && previous !== key) {
        store.removeItem(previous);
        // D-04: the previous user's shell preferences (pins, open groups,
        // recent pages) must go with their preferences cache — they reveal
        // which pages that account visited.
        clearShellPreferences();
      }
      store.removeItem(PREFERENCES_KEY);
      store.setItem(ACTIVE_PREFERENCES_KEY, key);
      window.dispatchEvent(new Event(PREFERENCES_EVENT));
      if (!userId) return;
      const before = store.getItem(key);
      void fetch("/api/preferences", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok || response.headers.get("X-Preferences-User") !== encodeURIComponent(userId)) return;
          const prefs = await response.json();
          if (!controller.signal.aborted && preferencesStorageKey() === key && store.getItem(ACTIVE_PREFERENCES_KEY) === key && store.getItem(key) === before) {
            writeUserPreferencesCache(prefs);
          }
        }).catch(() => undefined);
    } catch { return; }
    const notify = (event: StorageEvent) => {
      if (event.key === key || event.key === ACTIVE_PREFERENCES_KEY) window.dispatchEvent(new Event(PREFERENCES_EVENT));
    };
    window.addEventListener("storage", notify);
    return () => {
      controller.abort();
      window.removeEventListener("storage", notify);
    };
  }, [userId]);
  return null;
}
