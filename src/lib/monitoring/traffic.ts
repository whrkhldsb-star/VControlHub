import { sampleId, withSamplingClaim, type SamplingClaim } from "@/lib/monitoring/sampling-claim";

export type NetworkDeviceStats = {
	iface: string;
	rxBytes: number;
	txBytes: number;
};

export type TrafficCounterSample = {
	rxBytes: number;
	txBytes: number;
	sampledAt: string;
};

export type TrafficRate = {
	rxBytesPerSecond: number;
	txBytesPerSecond: number;
	intervalSeconds: number;
};

export type PersistTrafficSampleInput = {
	source: string;
	serverId: string | null;
	iface: string;
	sampledAt?: Date;
	rxBytes: number;
	txBytes: number;
	rxRateBps: number;
	txRateBps: number;
};

/**
 * Append one traffic_snapshots row. Shared by the /api/traffic/summary route
 * (best-effort: the live response must not fail on a history-write error)
 * and the 5-minute sampling worker (errors propagate to the job result).
 * Callers own that policy — this function only writes.
 */
export async function persistTrafficSample(input: PersistTrafficSampleInput, claim?: SamplingClaim): Promise<boolean> {
	const data = {
		source: input.source,
		serverId: input.serverId,
		iface: input.iface,
		...(input.sampledAt ? { sampledAt: input.sampledAt } : {}),
		rxBytes: BigInt(Math.max(0, Math.trunc(input.rxBytes))),
		txBytes: BigInt(Math.max(0, Math.trunc(input.txBytes))),
		rxRateBps: Math.max(0, input.rxRateBps),
		txRateBps: Math.max(0, input.txRateBps),
	};
	return withSamplingClaim(claim, async (tx) => {
		if (!claim) {
			await tx.trafficSnapshot.create({ data });
			return true;
		}
		const result = await tx.trafficSnapshot.createMany({
			data: { ...data, id: sampleId("traffic-local", claim.jobId, input.iface) },
			skipDuplicates: true,
		});
		return result.count === 1;
	});
}

// Devices that are not the host's network card: bridges, container and VM links, tunnels, traffic-shaping
// (ifb) and dummy devices. An ifb0 listed before eth0 made the traffic page show 0 B/s for the hub.
const VIRTUAL_INTERFACE_PREFIXES = [
	"docker", "br-", "veth", "virbr", "tun", "tap", "vEthernet", "Loopback",
	"ifb", "dummy", "wg", "tailscale", "zt", "lxc", "lxdbr", "vboxnet", "vmnet", "cni", "flannel", "cali", "kube-",
];

const MAX_PARSED_TRAFFIC_INTERFACES = 64;

export function parseNetworkDeviceStats(content: string, options: { includeLoopback?: boolean } = {}): NetworkDeviceStats[] {
	const result: NetworkDeviceStats[] = [];
	const lines = content.split("\n");
	for (let i = 2; i < lines.length && result.length < MAX_PARSED_TRAFFIC_INTERFACES; i += 1) {
		const line = lines[i]!.trim();
		if (!line) continue;
		const [rawIface, ...values] = line.split(/\s+/);
		if (!rawIface || values.length < 9) continue;
		const iface = rawIface.replace(/:$/, "").slice(0, 64);
		if (!iface || (!options.includeLoopback && iface === "lo")) continue;
		const rxBytes = Number(values[0]);
		const txBytes = Number(values[8]);
		if (Number.isFinite(rxBytes) && Number.isFinite(txBytes)) {
			result.push({ iface, rxBytes, txBytes });
		}
	}
	return result;
}

export function selectPrimaryInterface(interfaces: NetworkDeviceStats[]): NetworkDeviceStats | null {
	if (interfaces.length === 0) return null;
	const physical = interfaces.find((item) => !VIRTUAL_INTERFACE_PREFIXES.some((prefix) => item.iface.startsWith(prefix)));
	return physical ?? interfaces[0]!;
}

export function calculateTrafficRate(previous: TrafficCounterSample | null, current: TrafficCounterSample): TrafficRate {
	if (!previous) return { rxBytesPerSecond: 0, txBytesPerSecond: 0, intervalSeconds: 0 };
	const previousTime = Date.parse(previous.sampledAt);
	const currentTime = Date.parse(current.sampledAt);
	const intervalSeconds = Math.max(0, (currentTime - previousTime) / 1000);
	if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
		return { rxBytesPerSecond: 0, txBytesPerSecond: 0, intervalSeconds: 0 };
	}
	const rxDelta = Math.max(0, current.rxBytes - previous.rxBytes);
	const txDelta = Math.max(0, current.txBytes - previous.txBytes);
	return {
		rxBytesPerSecond: Math.round(rxDelta / intervalSeconds),
		txBytesPerSecond: Math.round(txDelta / intervalSeconds),
		intervalSeconds,
	};
}

/**
 * How long a cached counter stays usable as a rate baseline (TR: one constant,
 * two former copies in remote-traffic.ts and server-traffic-snapshot.ts).
 *
 * One hour is far longer than the 5-minute sampling cadence, so a healthy
 * server never loses its baseline; beyond it, a rate computed against the
 * stored counter would divide the delta by the whole gap and report a
 * long-run average as if it were current throughput.
 */
export const PREVIOUS_SAMPLE_TTL_MS = 60 * 60 * 1000;

/**
 * Drop cached counters not refreshed within {@link PREVIOUS_SAMPLE_TTL_MS}
 * (or with an unparseable timestamp). Keeps the previous-sample maps bounded:
 * a server deleted from the fleet (or a renamed/disappeared interface)
 * otherwise kept its entry for the lifetime of the process.
 */
export function evictStaleTrafficSamples(samples: Map<string, TrafficCounterSample>, now: number): void {
	for (const [key, sample] of samples) {
		const sampledAt = Date.parse(sample.sampledAt);
		if (!Number.isFinite(sampledAt) || now - sampledAt > PREVIOUS_SAMPLE_TTL_MS) {
			samples.delete(key);
		}
	}
}

export { formatBytes, formatBytesPerSecond } from "@/lib/format/bytes";
