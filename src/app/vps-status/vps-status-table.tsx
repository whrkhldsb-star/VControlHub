"use client";

/**
 * Table view of the VPS fleet. Extracted 1:1 from `vps-status-client.tsx`.
 */

import { formatBytes } from "@/lib/format/bytes";

import {
	statusLabelKey,
	statusToneClasses,
	unknownTone,
	usageColor,
} from "@/app/health/health-dashboard-helpers";
import type { ServerHealth } from "@/app/health/health-types";

import { formatDisk, formatKbps, formatMem } from "./vps-node-card";

export function VpsStatusTable({
	servers,
	browserLocale,
	t,
}: {
	servers: ServerHealth[];
	browserLocale: string;
	t: (key: string, vars?: Record<string, string | number>) => string;
}) {
	return (
		<div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
			<table className="min-w-full border-collapse text-left text-xs">
				<thead className="bg-[var(--surface-elevated)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
					<tr>
						<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.name")}</th>
						<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.status")}</th>
						<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.cpu")}</th>
						<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.mem")}</th>
						<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.disk")}</th>
						<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.load")}</th>
						<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.net")}</th>
						<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.monthTraffic")}</th>
						<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.uptime")}</th>
						<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.updated")}</th>
					</tr>
				</thead>
				<tbody>
					{servers.map((server) => {
						const sc = statusToneClasses[server.status] ?? unknownTone;
						return (
							<tr
								key={server.serverId}
								className="border-t border-[var(--border-subtle)] hover:bg-[var(--surface-elevated)]/60"
							>
								<td className="px-3 py-2.5">
									<div className="flex items-center gap-2">
										<span className={`inline-flex h-2 w-2 rounded-full ${sc.dot}`} />
										<div className="min-w-0">
											<div className="truncate font-medium text-[var(--text-primary)]">
												{server.serverName}
											</div>
											<div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
												{server.host}
											</div>
										</div>
									</div>
								</td>
								<td className="px-3 py-2.5">
									<span
										className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${sc.bg} ${sc.text}`}
									>
										{t(statusLabelKey(server.status))}
									</span>
								</td>
								<td className={`px-3 py-2.5 font-mono tabular-nums ${usageColor(server.cpu)}`}>
									{server.cpu !== undefined ? `${server.cpu.toFixed(1)}%` : "—"}
								</td>
								<td className={`px-3 py-2.5 font-mono tabular-nums ${usageColor(server.mem)}`}>
									{server.mem !== undefined ? `${server.mem.toFixed(1)}%` : "—"}
									{server.memUsedMb !== undefined ? (
										<div className="text-[10px] font-normal text-[var(--text-muted)]">
											{formatMem(server.memUsedMb, server.memTotalMb)}
										</div>
									) : null}
								</td>
								<td className={`px-3 py-2.5 font-mono tabular-nums ${usageColor(server.diskMax)}`}>
									{server.diskMax !== undefined ? `${server.diskMax.toFixed(1)}%` : "—"}
									{server.diskUsedLabel ? (
										<div className="text-[10px] font-normal text-[var(--text-muted)]">
											{formatDisk(server.diskUsedLabel, server.diskTotalLabel)}
										</div>
									) : null}
								</td>
								<td className="px-3 py-2.5 font-mono tabular-nums text-[var(--text-secondary)]">
									{server.loadAvg1m !== undefined ? server.loadAvg1m.toFixed(2) : "—"}
								</td>
								<td className="px-3 py-2.5 font-mono tabular-nums text-[var(--text-secondary)]">
									{formatKbps(server.networkInKbps)} / {formatKbps(server.networkOutKbps)}
								</td>
								<td className="px-3 py-2.5 font-mono tabular-nums text-[var(--text-secondary)]">
									↓{formatBytes(server.monthlyRxBytes)} / ↑{formatBytes(server.monthlyTxBytes)}
								</td>
								<td className="px-3 py-2.5 text-[var(--text-secondary)]">{server.uptime ?? "—"}</td>
								<td className="px-3 py-2.5 text-[var(--text-muted)]">
									{server.lastCheck
										? new Date(server.lastCheck).toLocaleString(browserLocale, {
												month: "2-digit",
												day: "2-digit",
												hour: "2-digit",
												minute: "2-digit",
												hour12: false,
											})
										: "—"}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
