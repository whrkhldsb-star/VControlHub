/**
 * Local (hub-host) network interface counters.
 *
 * POSIX reads /proc/net/dev directly. Windows has no /proc: counters come
 * from `Get-NetAdapterStatistics` via PowerShell, which costs a process
 * spawn — so results are cached briefly. The rest of the traffic pipeline
 * (rate diffing, primary-interface selection) is shared and platform-free.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

import { parseNetworkDeviceStats, type NetworkDeviceStats } from "./traffic";
import { isWindows } from "@/lib/runtime/platform-paths";

const WINDOWS_CACHE_TTL_MS = 2_000;
let windowsCache: { sampledAt: number; rows: NetworkDeviceStats[] } | null = null;
let windowsInflight: Promise<NetworkDeviceStats[]> | null = null;

function execFileText(file: string, args: readonly string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: "utf-8", timeout: 10_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

async function collectWindowsNetworkAdapters(): Promise<NetworkDeviceStats[]> {
	const rows: NetworkDeviceStats[] = [];
	try {
		// Adapter names may contain spaces ("vEthernet (Default Switch)") —
		// tab-separated output keeps parsing unambiguous.
		const { stdout: output } = await execFileText(
			"powershell",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				'Get-NetAdapterStatistics | ForEach-Object { $_.Name + "`t" + $_.ReceivedBytes + "`t" + $_.SentBytes }',
			],
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
		// Keep rows empty: an unavailable reading must not break monitoring.
	}
	windowsCache = { sampledAt: Date.now(), rows };
	return rows;
}

function sampleWindowsNetworkAdapters(): Promise<NetworkDeviceStats[]> {
	const now = Date.now();
	if (windowsCache && now - windowsCache.sampledAt < WINDOWS_CACHE_TTL_MS) {
		return Promise.resolve(windowsCache.rows);
	}
	if (windowsInflight) return windowsInflight;
	windowsInflight = collectWindowsNetworkAdapters().finally(() => {
		windowsInflight = null;
	});
	return windowsInflight;
}

/** Cumulative rx/tx counters for every local interface, excluding loopback. */
export async function readLocalNetworkDeviceStats(): Promise<NetworkDeviceStats[]> {
	if (isWindows()) return sampleWindowsNetworkAdapters();
	try {
		return parseNetworkDeviceStats(readFileSync("/proc/net/dev", "utf-8"));
	} catch {
		return [];
	}
}
