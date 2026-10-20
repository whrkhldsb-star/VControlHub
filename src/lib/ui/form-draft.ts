import type { Dispatch, SetStateAction } from "react";

/**
 * Reset a field after its save succeeded, but only if it still holds what
 * was saved. Fields stay editable while a save is pending: clearing them
 * unconditionally threw away whatever the user typed meanwhile (the next
 * draft, never submitted).
 */
export function clearIfUnchanged<T>(setter: Dispatch<SetStateAction<T>>, submitted: T, empty: T) {
  setter((current) => (Object.is(current, submitted) ? empty : current));
}
