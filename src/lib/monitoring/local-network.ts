/**
 * Local (hub-host) network interface counters.
 *
 * POSIX reads /proc/net/dev directly. Windows has no /proc: counters come
 * from `Get-NetAdapterStatistics` via PowerShell, which costs a process
 * spawn — so results are cached briefly. The rest of the traffic pipeline
 * (rate diffing, primary-interface selection) is shared and platform-free.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { parseNetworkDeviceStats, type NetworkDeviceStats } from "./traffic";
import { isWindows } from "@/lib/runtime/platform-paths";

const WINDOWS_CACHE_TTL_MS = 2_000;
let windowsCache: { sampledAt: number; rows: NetworkDeviceStats[] } | null = null;

function sampleWindowsNetworkAdapters(): NetworkDeviceStats[] {
	const now = Date.now();
	if (windowsCache && now - windowsCache.sampledAt < WINDOWS_CACHE_TTL_MS) {
		return windowsCache.rows;
	}
	const rows: NetworkDeviceStats[] = [];
	try {
		// Adapter names may contain spaces ("vEthernet (Default Switch)") —
		// tab-separated output keeps parsing unambiguous.
		const output = execFileSync(
			"powershell",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				'Get-NetAdapterStatistics | ForEach-Object { $_.Name + "`t" + $_.ReceivedBytes + "`t" + $_.SentBytes }',
			],
			{ encoding: "utf-8", timeout: 10_000, windowsHide: true },
		);
		for (const line of output.split(/\r?\n/)) {
			const [iface, rx, tx] = line.split("\t");
			if (!iface || rx === undefined || tx === undefined) continue;
			const rxBytes = Number(rx);
			const txBytes = Number(tx);
			if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue;
			rows.push({ iface: iface.trim(), rxBytes, txBytes });
		}
	} catch {
		// Keep whatever we have (possibly nothing): an unavailable reading
		// must not break the monitoring response.
	}
	windowsCache = { sampledAt: now, rows };
	return rows;
}

/** Cumulative rx/tx counters for every local interface, excluding loopback. */
export function readLocalNetworkDeviceStats(): NetworkDeviceStats[] {
	if (isWindows()) return sampleWindowsNetworkAdapters();
	try {
		return parseNetworkDeviceStats(readFileSync("/proc/net/dev", "utf-8"));
	} catch {
		return [];
	}
}
