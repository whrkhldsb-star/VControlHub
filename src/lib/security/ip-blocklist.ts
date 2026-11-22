/**
 * Single SSRF blocklist for IP literals (TR: one policy, three former copies).
 *
 * Three modules used to carry private copies of "is this IP safe to fetch":
 * security/webhook-url.ts, downloads/source-url.ts and
 * storage/direct-access-url.ts. They drifted: only two of the three knew about
 * the deprecated IPv4-compatible IPv6 form (`::169.254.169.254` slipped past
 * the storage copy and its AI-provider BaseURL validation). Everything now
 * imports from here so the policy can only exist once.
 *
 * The IPv4 policy is the union of the three former copies: 0/8, 10/8,
 * 100.64/10 (CGNAT), 127/8, 169.254/16 (link-local incl. cloud metadata),
 * 172.16/12, 192.0.0/24 (except global anycast), TEST-NET-1, 192.88.99/24 (6to4 relay),
 * 192.168/16, 198.18/15 (benchmark), 224/4 (multicast), 240/4 (reserved).
 */

import { isIPv6 } from "node:net";

function blockedIpv4(a: number, b: number, c: number, d: number, allowPrivate: boolean) {
	// Private providers may use loopback, RFC 1918 and shared address space.
	if (a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
		|| (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return !allowPrivate;
	return a === 0 || (a === 169 && b === 254) || (a === 192 && b === 0 && (c === 2 || (c === 0 && d !== 9 && d !== 10)))
		|| (a === 192 && b === 88 && c === 99)
		|| (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function parseDottedQuad(hostname: string): number[] | null {
	const parts = hostname.split(".");
	if (parts.length !== 4) return null;
	const bytes = parts.map((part) => {
		if (!/^\d{1,3}$/.test(part)) return Number.NaN;
		const value = Number(part);
		return value >= 0 && value <= 255 ? value : Number.NaN;
	});
	return bytes.every(Number.isInteger) ? bytes : null;
}

/**
 * Expand an IPv6 literal (brackets optional) into eight 16-bit groups.
 * Returns null when the literal cannot be parsed.
 */
export function expandIpv6Address(address: string): number[] | null {
	const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
	if (!isIPv6(normalized) || normalized.includes("%")) return null;
	// WHATWG canonicalization converts every dotted IPv4 tail to two hex words.
	const canonical = new URL(`http://[${normalized}]`).hostname.slice(1, -1);
	const [left, right] = canonical.split("::");
	const words = (part: string | undefined) => part ? part.split(":").map(word => Number.parseInt(word, 16)) : [];
	const head = words(left);
	const tail = words(right);
	return [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

/** Public IPv6 destinations must be global unicast, excluding special-purpose
 * assignments (including Teredo, benchmarking, documentation and 6to4).
 * An explicit private-provider exception additionally allows loopback and ULA.
 */
export function isBlockedIpAddress(address: string, allowPrivate = false): boolean {
	const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
	if (!normalized) return true;
	if (!normalized.includes(":")) {
		const octets = parseDottedQuad(normalized);
		if (!octets) return false; // Hostnames are checked after DNS resolution.
		return blockedIpv4(octets[0]!, octets[1]!, octets[2]!, octets[3]!, allowPrivate);
	}
	const parts = expandIpv6Address(normalized);
	if (!parts) return true;
	const [first, second] = parts as [number, number, ...number[]];
	if (parts.slice(0, 5).every((word) => word === 0) && (parts[5] === 0 || parts[5] === 0xffff)) {
		if (parts[5] === 0 && parts[6] === 0 && parts[7] === 1) return !allowPrivate;
		const highWord = parts[6]!;
		const lowWord = parts[7]!;
		return blockedIpv4(highWord >> 8, highWord & 255, lowWord >> 8, lowWord & 255, allowPrivate);
	}
	if (allowPrivate && (first & 0xfe00) === 0xfc00) {
		// EC2 also exposes its metadata service on a unique-local address.
		return first === 0xfd00 && second === 0xec2 && parts.slice(2, 7).every((word) => word === 0) && parts[7] === 0x254;
	}
	return (first & 0xe000) !== 0x2000 || first === 0x2002
		|| (first === 0x2001 && (second < 0x0200 || second === 0x0db8))
		|| (first === 0x3fff && (second & 0xf000) === 0);
}
