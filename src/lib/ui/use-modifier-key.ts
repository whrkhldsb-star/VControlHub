import { useSyncExternalStore } from "react";

export type ModifierKey = "⌘" | "Ctrl";

/** Apple keyboards carry ⌘; everything else — Windows, Linux, ChromeOS — has Ctrl in that role. */
export function modifierKeyOf(platform: string): ModifierKey {
	return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl";
}

function read(): ModifierKey {
	const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
	return modifierKeyOf(nav.userAgentData?.platform || nav.platform || nav.userAgent || "");
}

const subscribe = () => () => undefined;

/**
 * The key that goes with K for the command palette, as this keyboard labels it. The top bar and the shortcut
 * list showed "⌘K" on every system, a key most keyboards do not have.
 *
 * The server cannot know the keyboard: it renders "Ctrl", and an Apple device corrects it when the page comes
 * alive (useSyncExternalStore keeps that from being a hydration mismatch).
 */
export function useModifierKey(): ModifierKey {
	return useSyncExternalStore(subscribe, read, () => "Ctrl");
}
