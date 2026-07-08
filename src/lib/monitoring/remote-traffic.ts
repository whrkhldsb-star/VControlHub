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
 *    as the local /proc/net/dev sampler.
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
		return { ...base, error: "SSH credentials not configured, skipping traffic sampling" };
	}
	try {
		const sshParams = await buildSshParamsFromServer(server, server.sshKey);
		const { stdout, exitCode, stderr } = await execRemoteCommand({
			...sshParams,
			command: "cat /proc/net/dev",
			timeout: SAMPLE_TIMEOUT_MS,
		});
		if (exitCode !== 0) {
			return { ...base, error: `Remote command exit code ${exitCode}: ${stderr.trim().slice(0, 120)}` };
		}
		const interfaces = parseNetworkDeviceStats(stdout);
		if (interfaces.length === 0) {
			return { ...base, error: "Failed to parse /proc/net/dev" };
		}
		const summarized = interfaces.map((item) => summarizeRemoteInterface(server.id, item));
		const primarySrc = selectPrimaryInterface(interfaces);
		const primary = primarySrc
			? summarized.find((item) => item.iface === primarySrc.iface) ?? null
			: null;
		return { ...base, primaryInterface: primary, interfaces: summarized, error: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return { ...base, error: `Connection failed: ${message.slice(0, 200)}` };
	}
}

export async function sampleRemoteServersTraffic(
	servers: RemoteServerInput[],
): Promise<RemoteServerTraffic[]> {
	if (servers.length === 0) return [];
	const settled = await Promise.allSettled(
		servers.map((server) => sampleRemoteServerTraffic(server)),
	);
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
			error: result.reason instanceof Error ? result.reason.message : "Sampling failed",
		};
	});
}

/** Test-only reset of the per-process previous-sample cache. */
export function __resetRemoteTrafficCache(): void {
	previousRemoteSamples.clear();
}
