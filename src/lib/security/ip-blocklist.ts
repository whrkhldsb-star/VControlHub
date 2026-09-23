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
 * 172.16/12, 192.0/16 (IETF reserved + TEST-NET-1), 192.88/16 (6to4 relay),
 * 192.168/16, 198.18/15 (benchmark), 224/4 (multicast), 240/4 (reserved).
 */

const IPV4_BLOCKED_BYTES = (a: number, b: number): boolean =>
	a === 0 ||
	a === 10 ||
	a === 127 ||
	(a === 100 && b >= 64 && b <= 127) ||
	(a === 169 && b === 254) ||
	(a === 172 && b >= 16 && b <= 31) ||
	(a === 192 && (b === 0 || b === 88 || b === 168)) ||
	(a === 198 && (b === 18 || b === 19)) ||
	a >= 224;

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
	const normalized = address.toLowerCase();
	if (!normalized.includes(":")) return null;
	const [headRaw, tailRaw] = normalized.split("::", 2);
	const head = headRaw ? headRaw.split(":").filter(Boolean) : [];
	const tail = tailRaw ? tailRaw.split(":").filter(Boolean) : [];
	const ipv4Tail = [...head, ...tail].at(-1);
	if (ipv4Tail?.includes(".")) {
		const octets = ipv4Tail.split(".").map((part) => Number.parseInt(part, 10));
		if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
		const first = ((octets[0]! << 8) | octets[1]!).toString(16);
		const second = ((octets[2]! << 8) | octets[3]!).toString(16);
		if (tail.length && tail.at(-1) === ipv4Tail) tail.splice(tail.length - 1, 1, first, second);
		else head.splice(head.length - 1, 1, first, second);
	}
	if (normalized.includes("::")) {
		const missing = 8 - head.length - tail.length;
		if (missing < 0) return null;
		return [...head, ...Array(missing).fill("0"), ...tail].map((part) => Number.parseInt(part || "0", 16));
	}
	const parts = head.map((part) => Number.parseInt(part || "0", 16));
	return parts.length === 8 ? parts : null;
}

/**
 * True when the given IP literal must not be fetched server-side.
 *
 * Malformed IPv6 literals are treated as blocked (fail closed); malformed
 * IPv4 strings are not (callers gate on `isIP()` first, so a non-literal
 * hostname should fall through to suffix/DNS checks).
 */
export function isBlockedIpAddress(address: string): boolean {
	const normalized = address.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
	if (!normalized) return true;
	if (normalized.includes(":")) {
		const parts = expandIpv6Address(normalized);
		if (!parts || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return true;
		const allZero = parts.every((part) => part === 0);
		const loopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1;
		const uniqueLocal = (parts[0]! & 0xfe00) === 0xfc00;
		const linkLocal = (parts[0]! & 0xffc0) === 0xfe80;
		const multicast = (parts[0]! & 0xff00) === 0xff00;
		const ipv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
		// Both IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible
		// (::a.b.c.d — top 96 bits zero) form embed an IPv4 address in the low 32
		// bits. Evaluate it under the IPv4 rules so e.g. ::127.0.0.1 or
		// ::169.254.169.254 cannot bypass the private-range block.
		const ipv4Compatible = parts.slice(0, 6).every((part) => part === 0);
		if (ipv4Mapped || ipv4Compatible) {
			return isBlockedIpAddress(
				`${(parts[6]! >> 8) & 255}.${parts[6]! & 255}.${(parts[7]! >> 8) & 255}.${parts[7]! & 255}`,
			);
		}
		return allZero || loopback || uniqueLocal || linkLocal || multicast;
	}

	const ipv4 = parseDottedQuad(normalized);
	return ipv4 ? IPV4_BLOCKED_BYTES(ipv4[0]!, ipv4[1]!) : false;
}
