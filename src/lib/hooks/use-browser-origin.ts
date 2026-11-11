"use client";

import { useSyncExternalStore } from "react";

const never = () => () => undefined;

/**
 * The origin the page was opened on ("https://hub.example.com"), for addresses shown to the person. It is ""
 * while rendering on the server and while hydrating, so both render the same text; reading `window.location`
 * during render instead gives the server one text and the browser another, and the page is rendered twice.
 */
export function useBrowserOrigin(): string {
	return useSyncExternalStore(never, () => window.location.origin, () => "");
}
