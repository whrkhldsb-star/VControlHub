/** Base64 helpers for SSH terminal payload encoding. */

/** Pass bytes to xterm's streaming UTF-8 decoder; a packet may split a character. */
export function decodeBase64Bytes(b64: string): Uint8Array {
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function encodeBase64(str: string): string {
	return btoa(unescape(encodeURIComponent(str)));
}
