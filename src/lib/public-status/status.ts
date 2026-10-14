/**
 * Public node status — pure classification, shared by the list, the detail
 * page and the summary counts.
 *
 * - maintenance: an administrator marked the node; it overrides everything.
 * - online: an Agent heartbeat younger than AGENT_HEARTBEAT_FRESH_MS, or the
 *   latest reachability verdict is recent and says reachable with metrics.
 * - offline: the latest verdict is recent and says the host could not be
 *   reached (TCP probe failed) or its metrics could not be collected.
 * - stale: there was data once, but no verdict within the freshness window —
 *   typically the sampler or the Agent stopped. Never shown as green.
 * - unknown: never sampled.
 *
 * Metric freshness is reported separately (`metricsStale`): an Agent can keep
 * heart-beating while a long command delays its metric report, and the board
 * must then show old numbers as old instead of as current.
 */

export type PublicNodeStatus = "online" | "offline" | "unknown" | "stale" | "maintenance";

export const AGENT_HEARTBEAT_FRESH_MS = 90_000;
/** Interval assumed for rows that do not say (the former fixed cadence). */
export const LEGACY_SAMPLE_INTERVAL_SECONDS = 300;
/** A verdict or sample stays current for this many report intervals. */
export const FRESHNESS_INTERVALS = 3;
/** Lower bound of the freshness window, so a 60 s Agent tolerates jitter. */
export const MIN_FRESHNESS_MS = 180_000;

export type StatusInput = {
	maintenance: boolean;
	managementMode: "DIRECT" | "AGENT";
	agentLastSeenAt: Date | null;
	latest: {
		checkedAt: Date;
		online: boolean;
		offlineReason: string | null;
		metricsAt: Date | null;
		intervalSeconds: number | null;
	} | null;
	now: Date;
};

export type StatusResult = {
	status: PublicNodeStatus;
	/** Why the node is offline, when known. */
	offlineReason: "unreachable" | "collect_failed" | null;
	/** True when metrics exist but are older than their freshness window. */
	metricsStale: boolean;
	/** True when an Agent heartbeat is current (independent of metrics). */
	heartbeatFresh: boolean;
};

export function freshnessWindowMs(intervalSeconds: number | null | undefined): number {
	const interval = intervalSeconds && intervalSeconds > 0 ? intervalSeconds : LEGACY_SAMPLE_INTERVAL_SECONDS;
	return Math.max(MIN_FRESHNESS_MS, interval * FRESHNESS_INTERVALS * 1000);
}

export function classifyPublicNode(input: StatusInput): StatusResult {
	const nowMs = input.now.getTime();
	const heartbeatFresh =
		input.managementMode === "AGENT" &&
		input.agentLastSeenAt !== null &&
		nowMs - input.agentLastSeenAt.getTime() < AGENT_HEARTBEAT_FRESH_MS;
	const latest = input.latest;
	const window = freshnessWindowMs(latest?.intervalSeconds);
	const metricsStale = Boolean(latest?.metricsAt && nowMs - latest.metricsAt.getTime() > window);
	const verdictFresh = Boolean(latest && nowMs - latest.checkedAt.getTime() <= window);
	const reason =
		latest && !latest.online && (latest.offlineReason === "unreachable" || latest.offlineReason === "collect_failed")
			? latest.offlineReason
			: null;

	if (input.maintenance) return { status: "maintenance", offlineReason: null, metricsStale, heartbeatFresh };
	if (heartbeatFresh) return { status: "online", offlineReason: null, metricsStale: latest?.metricsAt ? metricsStale : false, heartbeatFresh };
	if (latest && verdictFresh) {
		return latest.online
			? { status: "online", offlineReason: null, metricsStale, heartbeatFresh }
			: { status: "offline", offlineReason: reason ?? "unreachable", metricsStale, heartbeatFresh };
	}
	if (latest || input.agentLastSeenAt) return { status: "stale", offlineReason: null, metricsStale: Boolean(latest?.metricsAt), heartbeatFresh };
	return { status: "unknown", offlineReason: null, metricsStale: false, heartbeatFresh };
}
