/**
 * Lightweight in-process runtime metrics for observability surfaces that do
 * not warrant a full Prometheus stack yet:
 * - Web Vitals (CLS/LCP/INP)
 * - WebSocket connection counters
 * - Notification delivery latency / failure rates
 *
 * Values live in process memory and reset on restart — intentional for a
 * single-node VPS console. Snapshot endpoints expose them for dashboards.
 */

export type PercentileSnapshot = {
	count: number;
	p50: number | null;
	p95: number | null;
	p99: number | null;
	max: number | null;
};

export type WebVitalName = "CLS" | "LCP" | "INP" | "FCP" | "TTFB";

export type WebVitalSample = {
	name: WebVitalName;
	value: number;
	rating?: "good" | "needs-improvement" | "poor";
	path?: string;
	navigationType?: string;
	at: number;
};

export type DeliveryChannel = "email" | "telegram" | "webhook" | "in_app_ws";

type ChannelStats = {
	success: number;
	failure: number;
	latenciesMs: number[];
};

type WsStats = {
	active: number;
	opened: number;
	closed: number;
	errors: number;
	rejected: number;
	/** Client-driven reconnect is not observed server-side; reserved for future. */
	reconnectHints: number;
};

const MAX_SAMPLES = 500;
const MAX_RECENT_VITALS = 100;

const webVitalBuckets = new Map<WebVitalName, number[]>();
const recentWebVitals: WebVitalSample[] = [];

const deliveryStats: Record<DeliveryChannel, ChannelStats> = {
	email: { success: 0, failure: 0, latenciesMs: [] },
	telegram: { success: 0, failure: 0, latenciesMs: [] },
	webhook: { success: 0, failure: 0, latenciesMs: [] },
	in_app_ws: { success: 0, failure: 0, latenciesMs: [] },
};

const wsStats: Record<"notification" | "ssh", WsStats> = {
	notification: { active: 0, opened: 0, closed: 0, errors: 0, rejected: 0, reconnectHints: 0 },
	ssh: { active: 0, opened: 0, closed: 0, errors: 0, rejected: 0, reconnectHints: 0 },
};

function pushBounded(list: number[], value: number, max = MAX_SAMPLES) {
	list.push(value);
	if (list.length > max) list.splice(0, list.length - max);
}

function percentile(sorted: number[], p: number): number | null {
	if (sorted.length === 0) return null;
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[idx] ?? null;
}

export function snapshotLatency(values: number[]): PercentileSnapshot {
	if (values.length === 0) {
		return { count: 0, p50: null, p95: null, p99: null, max: null };
	}
	const sorted = [...values].sort((a, b) => a - b);
	return {
		count: sorted.length,
		p50: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		p99: percentile(sorted, 99),
		max: sorted[sorted.length - 1] ?? null,
	};
}

export function recordWebVital(sample: Omit<WebVitalSample, "at"> & { at?: number }) {
	const name = sample.name;
	if (!["CLS", "LCP", "INP", "FCP", "TTFB"].includes(name)) return;
	if (!Number.isFinite(sample.value)) return;

	const bucket = webVitalBuckets.get(name) ?? [];
	pushBounded(bucket, sample.value);
	webVitalBuckets.set(name, bucket);

	const entry: WebVitalSample = {
		name,
		value: sample.value,
		rating: sample.rating,
		path: sample.path?.slice(0, 200),
		navigationType: sample.navigationType,
		at: sample.at ?? Date.now(),
	};
	recentWebVitals.push(entry);
	if (recentWebVitals.length > MAX_RECENT_VITALS) {
		recentWebVitals.splice(0, recentWebVitals.length - MAX_RECENT_VITALS);
	}
}

export function recordDelivery(channel: DeliveryChannel, input: { ok: boolean; durationMs: number }) {
	const stats = deliveryStats[channel];
	if (!stats) return;
	if (input.ok) stats.success += 1;
	else stats.failure += 1;
	if (Number.isFinite(input.durationMs) && input.durationMs >= 0) {
		pushBounded(stats.latenciesMs, input.durationMs);
	}
}

export async function timeDelivery<T>(
	channel: DeliveryChannel,
	fn: () => Promise<T>,
): Promise<T> {
	const started = performance.now();
	try {
		const result = await fn();
		recordDelivery(channel, { ok: true, durationMs: performance.now() - started });
		return result;
	} catch (error) {
		recordDelivery(channel, { ok: false, durationMs: performance.now() - started });
		throw error;
	}
}

export function recordWsEvent(
	kind: "notification" | "ssh",
	event: "open" | "close" | "error" | "reject" | "reconnect_hint",
) {
	const stats = wsStats[kind];
	switch (event) {
		case "open":
			stats.opened += 1;
			stats.active += 1;
			break;
		case "close":
			stats.closed += 1;
			stats.active = Math.max(0, stats.active - 1);
			break;
		case "error":
			stats.errors += 1;
			break;
		case "reject":
			stats.rejected += 1;
			break;
		case "reconnect_hint":
			stats.reconnectHints += 1;
			break;
	}
}

/** Force-set active count (useful when registry size is authoritative). */
export function setWsActive(kind: "notification" | "ssh", active: number) {
	wsStats[kind].active = Math.max(0, Math.floor(active));
}

export function getWebVitalSnapshot() {
	const byName = Object.fromEntries(
		(["CLS", "LCP", "INP", "FCP", "TTFB"] as WebVitalName[]).map((name) => [
			name,
			snapshotLatency(webVitalBuckets.get(name) ?? []),
		]),
	) as Record<WebVitalName, PercentileSnapshot>;

	return {
		byName,
		recent: [...recentWebVitals].slice(-20).reverse(),
	};
}

export function getDeliverySnapshot() {
	return (Object.keys(deliveryStats) as DeliveryChannel[]).reduce(
		(acc, channel) => {
			const stats = deliveryStats[channel];
			const total = stats.success + stats.failure;
			acc[channel] = {
				success: stats.success,
				failure: stats.failure,
				failureRate: total === 0 ? 0 : stats.failure / total,
				latency: snapshotLatency(stats.latenciesMs),
			};
			return acc;
		},
		{} as Record<
			DeliveryChannel,
			{
				success: number;
				failure: number;
				failureRate: number;
				latency: PercentileSnapshot;
			}
		>,
	);
}

export function getWsSnapshot() {
	return {
		notification: { ...wsStats.notification },
		ssh: { ...wsStats.ssh },
	};
}

export function getObservabilitySnapshot() {
	return {
		collectedAt: new Date().toISOString(),
		webVitals: getWebVitalSnapshot(),
		delivery: getDeliverySnapshot(),
		websocket: getWsSnapshot(),
	};
}

/** Test-only reset. */
export function __resetRuntimeMetricsForTests() {
	webVitalBuckets.clear();
	recentWebVitals.length = 0;
	for (const channel of Object.keys(deliveryStats) as DeliveryChannel[]) {
		deliveryStats[channel] = { success: 0, failure: 0, latenciesMs: [] };
	}
	wsStats.notification = { active: 0, opened: 0, closed: 0, errors: 0, rejected: 0, reconnectHints: 0 };
	wsStats.ssh = { active: 0, opened: 0, closed: 0, errors: 0, rejected: 0, reconnectHints: 0 };
}
