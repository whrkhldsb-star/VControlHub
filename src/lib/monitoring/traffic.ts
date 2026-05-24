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

const VIRTUAL_INTERFACE_PREFIXES = ["docker", "br-", "veth", "virbr", "tun", "tap"];

export function parseNetworkDeviceStats(content: string, options: { includeLoopback?: boolean } = {}): NetworkDeviceStats[] {
	return content
		.split("\n")
		.slice(2)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [rawIface, ...values] = line.split(/\s+/);
			const iface = rawIface.replace(/:$/, "");
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
	return physical ?? interfaces[0];
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

export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let value = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	if (unitIndex === 0) return `${Math.round(value)} ${units[unitIndex]}`;
	return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatBytesPerSecond(bytesPerSecond: number): string {
	return `${formatBytes(bytesPerSecond)}/s`;
}
