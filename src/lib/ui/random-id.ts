/**
 * A random version 4 UUID, in any page.
 *
 * `crypto.randomUUID` exists only in a secure context (HTTPS, or localhost). On an installation reached at
 * `http://<IP>` — the "IP direct, no domain" setup that deploy/README.md and the installer support — it is
 * undefined, and every browser-made id failed with "crypto.randomUUID is not a function": uploads, file moves,
 * deployments, the SSH file manager and the AI chat stopped at the first click. `crypto.getRandomValues` is
 * available in every context, so the id is built from it there.
 */
export function randomId(): string {
	const cryptoApi = globalThis.crypto;
	if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
	const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
