/**
 * Billing, expiry and traffic-quota arithmetic shared by the status board and
 * the server pages. Pure functions; nothing here reads the database.
 *
 * Traffic direction is from the server's side: `rx` is inbound (download),
 * `tx` outbound (upload). Providers bill either both directions together,
 * the larger one, or only one of them.
 */
export const TRAFFIC_QUOTA_MODES = ["sum", "max", "out", "in"] as const;
export type TrafficQuotaMode = (typeof TRAFFIC_QUOTA_MODES)[number];

export function isTrafficQuotaMode(value: unknown): value is TrafficQuotaMode {
	return typeof value === "string" && (TRAFFIC_QUOTA_MODES as readonly string[]).includes(value);
}

/** Bytes that count against the quota this period; null when the counters are unknown. */
export function quotaCountedBytes(mode: TrafficQuotaMode, rxBytes: number | null, txBytes: number | null): number | null {
	switch (mode) {
		case "in":
			return rxBytes;
		case "out":
			return txBytes;
		case "max":
			return rxBytes === null || txBytes === null ? null : Math.max(rxBytes, txBytes);
		default:
			return rxBytes === null || txBytes === null ? null : rxBytes + txBytes;
	}
}

/** Share of the quota used, 0–∞ (over 100 when exceeded); null without a quota or counters. */
export function quotaUsagePercent(mode: TrafficQuotaMode, rxBytes: number | null, txBytes: number | null, limitBytes: number | null): number | null {
	if (!limitBytes || limitBytes <= 0) return null;
	const counted = quotaCountedBytes(mode, rxBytes, txBytes);
	return counted === null ? null : (counted / limitBytes) * 100;
}

const DAY_MS = 86_400_000;

/** Whole days from now until the expiry instant (ceil); 0 or less once expired. */
export function daysUntil(expiresAt: string | Date, nowMs: number): number {
	const at = typeof expiresAt === "string" ? Date.parse(expiresAt) : expiresAt.getTime();
	return Math.ceil((at - nowMs) / DAY_MS);
}

export type ExpiryTone = "danger" | "warning" | "success" | "neutral";

/** Red within a week (or expired), amber within 15 days, green after that; neutral when far away. */
export function expiryTone(days: number): ExpiryTone {
	if (days <= 7) return "danger";
	if (days <= 15) return "warning";
	if (days > 3650) return "neutral";
	return "success";
}

/** Colour for a 0–100 usage figure: green, amber from 60 %, red from 80 % (Komari's thresholds). */
export function usageTone(value: number | null | undefined): "success" | "warning" | "danger" | "neutral" {
	if (value === null || value === undefined || !Number.isFinite(value)) return "neutral";
	if (value >= 80) return "danger";
	if (value >= 60) return "warning";
	return "success";
}
