export type DockerContainerStats = {
	id: string;
	name: string;
	cpuPercent: number;
	memoryUsageBytes: number;
	memoryLimitBytes: number;
	memoryPercent: number;
	networkRxBytes: number;
	networkTxBytes: number;
	blockReadBytes: number;
	blockWriteBytes: number;
	pids: number;
	readAt?: string;
};

export type DockerStatsTotal = {
	containerCount: number;
	cpuPercent: number;
	memoryUsageBytes: number;
	memoryLimitBytes: number;
	memoryPercent: number;
	networkRxBytes: number;
	networkTxBytes: number;
	blockReadBytes: number;
	blockWriteBytes: number;
	pids: number;
};

type DockerRawStats = Record<string, unknown>;

function numberAt(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nestedNumber(input: unknown, keys: string[]): number {
	let cursor = input;
	for (const key of keys) {
		if (!cursor || typeof cursor !== "object") return 0;
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return numberAt(cursor);
}

function nestedArray(input: unknown, keys: string[]): unknown[] {
	let cursor = input;
	for (const key of keys) {
		if (!cursor || typeof cursor !== "object") return [];
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return Array.isArray(cursor) ? cursor : [];
}

export function parseDockerStats(id: string, name: string, raw: DockerRawStats): DockerContainerStats {
	const cpuDelta = nestedNumber(raw, ["cpu_stats", "cpu_usage", "total_usage"]) - nestedNumber(raw, ["precpu_stats", "cpu_usage", "total_usage"]);
	const systemDelta = nestedNumber(raw, ["cpu_stats", "system_cpu_usage"]) - nestedNumber(raw, ["precpu_stats", "system_cpu_usage"]);
	const onlineCpus = nestedNumber(raw, ["cpu_stats", "online_cpus"])
		|| nestedArray(raw, ["cpu_stats", "cpu_usage", "percpu_usage"]).length
		|| 1;
	const cpuPercent = cpuDelta > 0 && systemDelta > 0 ? Math.round((cpuDelta / systemDelta) * onlineCpus * 1000) / 10 : 0;

	const memoryRawUsage = nestedNumber(raw, ["memory_stats", "usage"]);
	const memoryCache = nestedNumber(raw, ["memory_stats", "stats", "cache"]);
	const memoryUsageBytes = Math.max(0, memoryRawUsage - memoryCache);
	const memoryLimitBytes = nestedNumber(raw, ["memory_stats", "limit"]);
	const memoryPercent = memoryLimitBytes > 0 ? Math.round((memoryUsageBytes / memoryLimitBytes) * 1000) / 10 : 0;

	let networkRxBytes = 0;
	let networkTxBytes = 0;
	const networks = raw.networks && typeof raw.networks === "object" ? raw.networks as Record<string, unknown> : {};
	for (const net of Object.values(networks)) {
		networkRxBytes += nestedNumber(net, ["rx_bytes"]);
		networkTxBytes += nestedNumber(net, ["tx_bytes"]);
	}

	let blockReadBytes = 0;
	let blockWriteBytes = 0;
	for (const item of nestedArray(raw, ["blkio_stats", "io_service_bytes_recursive"])) {
		if (!item || typeof item !== "object") continue;
		const op = String((item as Record<string, unknown>).op ?? "").toLowerCase();
		const value = numberAt((item as Record<string, unknown>).value);
		if (op === "read") blockReadBytes += value;
		if (op === "write") blockWriteBytes += value;
	}

	return {
		id,
		name,
		cpuPercent,
		memoryUsageBytes,
		memoryLimitBytes,
		memoryPercent,
		networkRxBytes,
		networkTxBytes,
		blockReadBytes,
		blockWriteBytes,
		pids: nestedNumber(raw, ["pids_stats", "current"]),
		readAt: typeof raw.read === "string" ? raw.read : undefined,
	};
}

export function sumDockerStats(stats: DockerContainerStats[]): DockerStatsTotal {
	const total = stats.reduce<DockerStatsTotal>((acc, item) => ({
		containerCount: acc.containerCount + 1,
		cpuPercent: acc.cpuPercent + item.cpuPercent,
		memoryUsageBytes: acc.memoryUsageBytes + item.memoryUsageBytes,
		memoryLimitBytes: acc.memoryLimitBytes + item.memoryLimitBytes,
		memoryPercent: 0,
		networkRxBytes: acc.networkRxBytes + item.networkRxBytes,
		networkTxBytes: acc.networkTxBytes + item.networkTxBytes,
		blockReadBytes: acc.blockReadBytes + item.blockReadBytes,
		blockWriteBytes: acc.blockWriteBytes + item.blockWriteBytes,
		pids: acc.pids + item.pids,
	}), {
		containerCount: 0,
		cpuPercent: 0,
		memoryUsageBytes: 0,
		memoryLimitBytes: 0,
		memoryPercent: 0,
		networkRxBytes: 0,
		networkTxBytes: 0,
		blockReadBytes: 0,
		blockWriteBytes: 0,
		pids: 0,
	});
	return {
		...total,
		cpuPercent: Math.round(total.cpuPercent * 10) / 10,
		memoryPercent: total.memoryLimitBytes > 0 ? Math.round((total.memoryUsageBytes / total.memoryLimitBytes) * 1000) / 10 : 0,
	};
}
