/** Base64 helpers for SSH terminal payload encoding. */

export function decodeBase64(b64: string): string {
	try {
		return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
	} catch {
		return atob(b64);
	}
}

export function encodeBase64(str: string): string {
	return btoa(unescape(encodeURIComponent(str)));
}
