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

const VIRTUAL_INTERFACE_PREFIXES = ["docker", "br-", "veth", "virbr", "tun", "tap", "vEthernet", "Loopback"];

export function parseNetworkDeviceStats(content: string, options: { includeLoopback?: boolean } = {}): NetworkDeviceStats[] {
	return content
		.split("\n")
		.slice(2)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [rawIface, ...values] = line.split(/\s+/);
			const iface = rawIface!.replace(/:$/, "");
			const rxBytes = Number(values[0] ?? 0);
			const txBytes = Number(values[8] ?? 0);
			return { iface, rxBytes, txBytes };
		})
		.filter((item) => options.includeLoopback || item.iface !== "lo")
		.filter((item) => Number.isFinite(item.rxBytes) && Number.isFinite(item.txBytes));
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
