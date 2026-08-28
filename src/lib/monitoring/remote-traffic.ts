/**
 * Remote VPS traffic sampling.
 *
 * The /traffic page used to give up on remote servers and just show a "the
 * traffic happens over there, we don't know" placeholder. This module fixes
 * that: it SSHes into each enabled Server (or each SFTP-backed StorageNode
 * with a bound server), runs `cat /proc/net/dev` once per request, and
 * computes rx/tx rates by diffing against the previous sample held in a
 * per-process in-memory Map.
 *
 * Notes:
 *  - We deliberately use a short-lived SSH command (no persistent connection
 *    pool) because traffic-summary is polled at the user's chosen refresh
 *    interval (default 30s). The cost is one SSH handshake per server per
 *    poll, which is acceptable for fleets of < ~20 nodes.
 *  - The previous-sample Map is global to the process. Restarts reset the
 *    rate to 0 for the first poll after restart — that is the same behaviour
 *    as the local /proc/net/dev sampler. Entries not refreshed within
 *    PREVIOUS_SAMPLE_TTL_MS are evicted, so deleted servers and renamed
 *    interfaces cannot accumulate in a long-lived process.
 *  - SSH fan-out is chunked at REMOTE_SAMPLE_CONCURRENCY. `take: 200` at the
 *    call site used to mean one poll could open 200 concurrent SSH handshakes.
 *  - SSH errors are caught per-server: one offline VPS does not break the
 *    whole /traffic page.
 */
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import {
	calculateTrafficRate,
	formatBytes,
	formatBytesPerSecond,
	parseNetworkDeviceStats,
	selectPrimaryInterface,
	type NetworkDeviceStats,
	type TrafficCounterSample,
} from "@/lib/monitoring/traffic";
import { t } from "@/lib/i18n/service-translations";

export type RemoteServerInput = {
	id: string;
	name: string;
	host: string;
	port: number;
	username: string;
	sshKeyId: string | null;
	password: string | null;
	sshKey?: { privateKey: string | null } | null;
};

export type RemoteInterfaceTraffic = {
	iface: string;
	rxBytes: number;
	txBytes: number;
	rxLabel: string;
	txLabel: string;
	rxRateBytesPerSecond: number;
	txRateBytesPerSecond: number;
	rxRateLabel: string;
	txRateLabel: string;
	intervalSeconds: number;
};

export type RemoteServerTraffic = {
	serverId: string;
	serverName: string;
	host: string;
	primaryInterface: RemoteInterfaceTraffic | null;
	interfaces: RemoteInterfaceTraffic[];
	sampledAt: string;
	error: string | null;
};

const previousRemoteSamples = new Map<string, TrafficCounterSample>();

const SAMPLE_TIMEOUT_MS = 10_000;

/**
 * Bound concurrent SSH sessions per sampling run (aligned with
 * EXECUTE_TARGETS_CONCURRENCY in the command executor). Without this, one
 * /traffic poll over a 200-server fleet opened 200 handshakes at once.
 */
const REMOTE_SAMPLE_CONCURRENCY = 5;

/**
 * Drop a cached counter that has not been refreshed within this window. A
 * server deleted from the fleet (or an interface that disappeared) otherwise
 * kept its entry for the lifetime of the process. It also stops a rate from
 * being computed against an hours-old baseline, which would report a
 * long-run average as if it were the current throughput.
 */
const PREVIOUS_SAMPLE_TTL_MS = 60 * 60 * 1000;

function evictStalePreviousSamples(now: number): void {
	for (const [key, sample] of previousRemoteSamples) {
		const sampledAt = Date.parse(sample.sampledAt);
		if (!Number.isFinite(sampledAt) || now - sampledAt > PREVIOUS_SAMPLE_TTL_MS) {
			previousRemoteSamples.delete(key);
		}
	}
}

function sampleKey(serverId: string, iface: string): string {
	return `remote:${serverId}:${iface}`;
}

function summarizeRemoteInterface(
	serverId: string,
	sample: NetworkDeviceStats,
): RemoteInterfaceTraffic {
	const key = sampleKey(serverId, sample.iface);
	const current: TrafficCounterSample = {
		rxBytes: sample.rxBytes,
		txBytes: sample.txBytes,
		sampledAt: new Date().toISOString(),
	};
	const previous = previousRemoteSamples.get(key) ?? null;
	previousRemoteSamples.set(key, current);
	const rate = calculateTrafficRate(previous, current);
	return {
		iface: sample.iface,
		rxBytes: sample.rxBytes,
		txBytes: sample.txBytes,
		rxLabel: formatBytes(sample.rxBytes),
		txLabel: formatBytes(sample.txBytes),
		rxRateBytesPerSecond: rate.rxBytesPerSecond,
		txRateBytesPerSecond: rate.txBytesPerSecond,
		rxRateLabel: formatBytesPerSecond(rate.rxBytesPerSecond),
		txRateLabel: formatBytesPerSecond(rate.txBytesPerSecond),
		intervalSeconds: rate.intervalSeconds,
	};
}

export async function sampleRemoteServerTraffic(
	server: RemoteServerInput,
): Promise<RemoteServerTraffic> {
	const sampledAt = new Date().toISOString();
	const base = {
		serverId: server.id,
		serverName: server.name,
		host: server.host,
		primaryInterface: null as RemoteInterfaceTraffic | null,
		interfaces: [] as RemoteInterfaceTraffic[],
		sampledAt,
	};
	if (!server.sshKey?.privateKey && !server.password) {
		return { ...base, error: t("backend.traffic.remote.noCredentials") };
	}
	try {
		const sshParams = await buildSshParamsFromServer(server, server.sshKey);
		const { stdout, exitCode, stderr } = await execRemoteCommand({
			...sshParams,
			command: "cat /proc/net/dev",
			timeout: SAMPLE_TIMEOUT_MS,
		});
		if (exitCode !== 0) {
			return { ...base, error: t("backend.traffic.remote.commandFailed", { code: exitCode ?? -1, stderr: stderr.trim().slice(0, 120) }) };
		}
		const interfaces = parseNetworkDeviceStats(stdout);
		if (interfaces.length === 0) {
			return { ...base, error: t("backend.traffic.remote.parseFailed") };
		}
		const summarized = interfaces.map((item) => summarizeRemoteInterface(server.id, item));
		const primarySrc = selectPrimaryInterface(interfaces);
		const primary = primarySrc
			? summarized.find((item) => item.iface === primarySrc.iface) ?? null
			: null;
		return { ...base, primaryInterface: primary, interfaces: summarized, error: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return { ...base, error: t("backend.traffic.remote.connectionFailed", { message: message.slice(0, 200) }) };
	}
}

export async function sampleRemoteServersTraffic(
	servers: RemoteServerInput[],
): Promise<RemoteServerTraffic[]> {
	if (servers.length === 0) return [];
	// Evict before sampling: this run refreshes every key it still owns, so
	// whatever is stale now belongs to a server or interface that is gone.
	evictStalePreviousSamples(Date.now());
	const settled: PromiseSettledResult<RemoteServerTraffic>[] = new Array(servers.length);
	for (let i = 0; i < servers.length; i += REMOTE_SAMPLE_CONCURRENCY) {
		const chunk = servers.slice(i, i + REMOTE_SAMPLE_CONCURRENCY);
		const chunkResults = await Promise.allSettled(
			chunk.map((server) => sampleRemoteServerTraffic(server)),
		);
		for (let j = 0; j < chunkResults.length; j++) {
			settled[i + j] = chunkResults[j]!;
		}
	}
	return settled.map((result, index) => {
		if (result.status === "fulfilled") return result.value;
		const server = servers[index]!;
		return {
			serverId: server.id,
			serverName: server.name,
			host: server.host,
			primaryInterface: null,
			interfaces: [],
			sampledAt: new Date().toISOString(),
			error: result.reason instanceof Error ? result.reason.message : t("backend.traffic.remote.samplingFailed"),
		};
	});
}

/** Test-only reset of the per-process previous-sample cache. */
export function __resetRemoteTrafficCache(): void {
	previousRemoteSamples.clear();
}
