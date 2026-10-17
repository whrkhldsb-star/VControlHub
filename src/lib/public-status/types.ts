/**
 * Public status board data contract (shared by the API, the server-rendered
 * page and the browser). Everything here may be shown to anonymous visitors.
 *
 * Units: rates are bytes per second, counters bytes, memory/disk bytes,
 * latency milliseconds, percentages 0–100, durations seconds, timestamps ISO.
 * A missing measurement is `null` — never a default zero.
 */
import type { TrafficQuotaMode } from "./billing";
import type { PublicNodeStatus } from "./status";

export type { PublicNodeStatus };

export type PublicNodeMetrics = {
	cpu?: { usage: number | null; cores: number | null };
	load?: { load1: number | null; load5: number | null; load15: number | null };
	memory?: { usage: number | null; usedBytes: number | null; totalBytes: number | null; swapUsage: number | null };
	disk?: { usage: number | null; usedBytes: number | null; totalBytes: number | null };
	network?: { rxBytesPerSecond: number | null; txBytesPerSecond: number | null; rateWindowSeconds: number | null };
	traffic?: {
		periodRxBytes: number | null;
		periodTxBytes: number | null;
		periodStart: string | null;
		countedSince: string | null;
		/** Monthly allowance and the direction it counts; absent when unlimited. */
		quota?: { limitBytes: number; mode: TrafficQuotaMode };
	};
	uptime?: { seconds: number | null };
	latency?: { ms: number | null; ok: boolean | null; at: string | null };
	/** Process and socket counts of the latest sample. */
	connections?: { processes: number | null; tcp: number | null; udp: number | null };
};

/** What the node is; each field null when no sample reported it. */
export type PublicNodeSystem = {
	os: string | null;
	arch: string | null;
	kernel: string | null;
	cpuModel: string | null;
	virtualization: string | null;
};

/** Published only when the site shows billing. */
export type PublicNodeBilling = {
	/** Monthly price in `currency`; null when not recorded. */
	monthlyPrice: number | null;
	currency: string | null;
	/** Rental end (renewal or expiry); null when not recorded. */
	expiresAt: string | null;
};

export type PublicNode = {
	id: string;
	name: string;
	group: string | null;
	region: string | null;
	/** ISO 3166-1 alpha-2, shown as a flag. */
	countryCode: string | null;
	tags: string[];
	note: string | null;
	status: PublicNodeStatus;
	offlineReason: "unreachable" | "collect_failed" | null;
	/** Metrics exist but are older than their freshness window. */
	metricsStale: boolean;
	/** Real host-side time of the metric values shown. */
	metricsAt: string | null;
	/** Time of the latest reachability verdict. */
	checkedAt: string | null;
	/** Latest Agent heartbeat (Agent-managed nodes only). */
	heartbeatAt: string | null;
	/** Expected seconds between metric reports for this node. */
	reportIntervalSeconds: number | null;
	metrics: PublicNodeMetrics;
	system: PublicNodeSystem | null;
	billing: PublicNodeBilling | null;
};

export type PublicCountBucket = { name: string; total: number; online: number };

export type PublicBoardSummary = {
	total: number;
	online: number;
	offline: number;
	stale: number;
	unknown: number;
	maintenance: number;
	groups: PublicCountBucket[];
	regions: PublicCountBucket[];
	/** Country codes (flags) of the visible nodes. */
	countries: PublicCountBucket[];
	/** Sums over nodes whose current rate is known; null when none is. */
	rxBytesPerSecond: number | null;
	txBytesPerSecond: number | null;
	rateNodes: number;
	periodRxBytes: number | null;
	periodTxBytes: number | null;
	/** Newest metric sample time among visible nodes. */
	lastSampleAt: string | null;
	/** True when more nodes are published than the board loads at once. */
	truncated: boolean;
};

export type PublicSiteInfo = {
	title: string | null;
	description: string | null;
	announcement: string | null;
	defaultView: "cards" | "table";
	refreshSeconds: number;
	accent: string;
	metrics: string[];
	showPlatformStatus: boolean;
};

export type PublicBoardSort = "default" | "name" | "cpu" | "memory" | "disk" | "network" | "status";
export type PublicBoardStatusFilter = "all" | PublicNodeStatus;

export type PublicBoardQuery = {
	q: string;
	group: string;
	status: PublicBoardStatusFilter;
	sort: PublicBoardSort;
	dir: "asc" | "desc";
	page: number;
	pageSize: number;
};

export type PublicBoardResponse = {
	site: PublicSiteInfo;
	platform: { overall: "healthy" | "warning" | "critical" } | null;
	summary: PublicBoardSummary;
	query: PublicBoardQuery;
	filteredTotal: number;
	totalPages: number;
	nodes: PublicNode[];
	/** When this response was produced (page refresh time, not sample time). */
	generatedAt: string;
};

/** One day of the 90-day availability strip (application time zone). */
export type PublicUptimeDay = {
	date: string;
	/** Online share of the covered time; null when the day has no sample. */
	uptimePercent: number | null;
	checkCount: number;
	coveredMinutes: number;
	/** Minutes the day could have been covered (today: elapsed so far). */
	expectedMinutes: number;
};

export type PublicAvailabilityWindow = {
	/** Online share of the covered time, 0–100; null without samples. */
	percent: number | null;
	/** Covered share of the window, 0–100. */
	coveragePercent: number;
	samples: number;
	sufficient: boolean;
};

export type PublicNodeDetailResponse = {
	site: PublicSiteInfo;
	node: PublicNode;
	availability: { last24h: PublicAvailabilityWindow; last7d: PublicAvailabilityWindow } | null;
	uptimeDays: PublicUptimeDay[] | null;
	generatedAt: string;
};

export type PublicHistoryRange = "1h" | "6h" | "24h" | "7d" | "30d";

export type PublicHistoryPoint = {
	t: string;
	/** null marks a gap (no sample, or the node was offline). */
	cpu?: number | null;
	memory?: number | null;
	disk?: number | null;
	/** 1-minute load average. */
	load?: number | null;
	processes?: number | null;
	tcp?: number | null;
	udp?: number | null;
	online?: number;
	offline?: number;
};

export type PublicNetworkPoint = { t: string; rx: number | null; tx: number | null };
export type PublicLatencyPoint = { t: string; avg: number | null; min: number | null; max: number | null; ok: number; failed: number };

export type PublicHistoryResponse = {
	range: PublicHistoryRange;
	from: string;
	to: string;
	bucketSeconds: number;
	/** Sampling interval the data was recorded at (seconds), when known. */
	sampleIntervalSeconds: number | null;
	coveragePercent: number;
	samples: number;
	resources: PublicHistoryPoint[] | null;
	network: PublicNetworkPoint[] | null;
	latency: { points: PublicLatencyPoint[]; probes: number; failed: number; measured: boolean } | null;
	generatedAt: string;
};
