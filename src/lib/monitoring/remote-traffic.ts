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
	evictStaleTrafficSamples,
	formatBytes,
	formatBytesPerSecond,
	parseNetworkDeviceStats,
	selectPrimaryInterface,
	type NetworkDeviceStats,
	type TrafficCounterSample,
} from "@/lib/monitoring/traffic";
import { t } from "@/lib/i18n/service-translations";
import type { StoredSshKey } from "@/lib/ssh/ssh-key-crypto";

export type RemoteServerInput = {
	teamId: string | null;
	agentTokenHash: string | null;
	id: string;
	name: string;
	host: string;
	port: number;
	username: string;
	sshKeyId: string | null;
	password: string | null;
	connectionType: string;
	/** Agent-managed servers are sampled through the Agent. */
	managementMode: string;
	/** Windows servers have no /proc/net/dev to read. */
	operatingSystem: string;
	/** The saved host-key pin; without it the sample would connect unverified. */
	hostKeySha256: string | null;
	sshKey?: StoredSshKey | null;
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
	// The sample reads /proc/net/dev: on Windows (over its OpenSSH or its
	// Agent) every summary load ran a command bound to fail.
	if (server.operatingSystem === "WINDOWS") {
		return { ...base, error: t("backend.traffic.remote.unsupportedOs") };
	}
	// An Agent-managed server needs no SSH credentials: commands go through its Agent.
	if (!server.sshKey?.privateKey && !server.password && server.managementMode !== "AGENT") {
		return { ...base, error: t("backend.traffic.remote.noCredentials") };
	}
	try {
		const sshParams = await buildSshParamsFromServer(server, server.sshKey, server.teamId);
		const { stdout, exitCode, stderr } = await execRemoteCommand({
			...sshParams,
			preferAgent: true,
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
	...args: [RemoteServerInput[]] | [{ id: string }[], (batch: { id: string }[]) => Promise<RemoteServerInput[]>]
): Promise<RemoteServerTraffic[]> {
	const [servers] = args;
	if (servers.length === 0) return [];
	// Evict before sampling: this run refreshes every key it still owns, so
	// whatever is stale now belongs to a server or interface that is gone.
	evictStaleTrafficSamples(previousRemoteSamples, Date.now());
	const results: RemoteServerTraffic[] = [];
	for (let i = 0; i < servers.length; i += REMOTE_SAMPLE_CONCURRENCY) {
		const end = i + REMOTE_SAMPLE_CONCURRENCY;
		const chunk = args.length === 2 ? await args[1](args[0].slice(i, end)) : args[0].slice(i, end);
		const settled = await Promise.allSettled(chunk.map(sampleRemoteServerTraffic));
		for (const [index, result] of settled.entries()) {
			const server = chunk[index]!;
			results.push(result.status === "fulfilled" ? result.value : {
				serverId: server.id, serverName: server.name, host: server.host,
				primaryInterface: null, interfaces: [], sampledAt: new Date().toISOString(),
				error: result.reason instanceof Error ? result.reason.message : t("backend.traffic.remote.samplingFailed"),
			});
		}
	}
	return results;
}

/** Test-only reset of the per-process previous-sample cache. */
export function __resetRemoteTrafficCache(): void {
	previousRemoteSamples.clear();
}
