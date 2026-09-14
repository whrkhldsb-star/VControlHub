"use client";

import { StatCard } from "@/components/page-shell";
import type { HealthOverview } from "./health-types";
import { usageBarTone, usageColor, type TFunc } from "./health-dashboard-helpers";
import { ProgressBar } from "@/components/ui-primitives";

export function SummaryCard({
	label,
	value,
	color,
}: {
	label: string;
	value: number | string;
	color: string;
}) {
  const accentColor = color === "emerald" || color === "amber" || color === "rose" ? color : undefined;
  return <StatCard label={label} value={value} accent={Boolean(accentColor)} accentColor={accentColor} />;
}

export function UsageCell({ value, label }: { value: number | undefined; label: string }) {
	if (value === undefined) return <span className="text-xs text-[var(--text-muted)]">—</span>;
	return (
		<div className="flex min-w-[100px] items-center gap-2">
			<ProgressBar label={label} value={value} height="sm" tone={usageBarTone(value)} className="flex-1" />
			<span className={`w-12 text-right font-mono text-xs tabular-nums ${usageColor(value)}`}>
				{value.toFixed(1)}%
			</span>
		</div>
	);
}

function FleetMetricBar({ label, value, unit }: { label: string; value: number; unit: string }) {
	return (
		<div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
			<div className="flex items-baseline justify-between">
				<p className="text-xs uppercase  text-[var(--text-muted)]">{label}</p>
				<p className={`text-xl font-bold ${usageColor(value)}`}>
					{value}
					{unit}
				</p>
			</div>
			<ProgressBar label={label} value={value} height="sm" tone={usageBarTone(value)} className="mt-2" />
		</div>
	);
}

export function FleetResourceSummary({
	overview,
	t,
	tt,
}: {
	overview: HealthOverview;
	t: TFunc;
	tt: (key: string, vars?: Record<string, string | number>) => string;
}) {
	const onlineServers = overview.servers.filter(
		(s) => s.status !== "offline" && s.cpu !== undefined,
	);

	if (onlineServers.length === 0) return null;

	const avg = (arr: number[]) =>
		arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
	const cpus = onlineServers.map((s) => s.cpu ?? 0);
	const mems = onlineServers.map((s) => s.mem ?? 0);
	const disks = onlineServers.map((s) => s.diskMax ?? 0);
	const loads = onlineServers.map((s) => s.loadAvg1m ?? 0).filter((v) => v > 0);

	const avgCpu = avg(cpus);
	const avgMem = avg(mems);
	const avgDisk = avg(disks);
	const avgLoad = loads.length
		? Math.round((loads.reduce((a, b) => a + b, 0) / loads.length) * 100) / 100
		: 0;

	const top5 = [...onlineServers]
		.sort(
			(a, b) =>
				(b.cpu ?? 0) +
				(b.mem ?? 0) +
				(b.diskMax ?? 0) -
				((a.cpu ?? 0) + (a.mem ?? 0) + (a.diskMax ?? 0)),
		)
		.slice(0, 5);

	const netInTotal = onlineServers.reduce((sum, s) => sum + (s.networkInKbps ?? 0), 0);
	const netOutTotal = onlineServers.reduce((sum, s) => sum + (s.networkOutKbps ?? 0), 0);

	const fmtKbps = (kbps: number) => {
		if (kbps >= 1_000_000) return `${(kbps / 1_000_000).toFixed(1)} Gbps`;
		if (kbps >= 1_000) return `${(kbps / 1_000).toFixed(1)} Mbps`;
		return `${Math.round(kbps)} Kbps`;
	};

	return (
		<section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
			<div className="flex items-center justify-between">
				<div>
					<p className="text-xs uppercase  text-[var(--text-muted)]">
						{t("healthPage.fleet.eyebrow")}
					</p>
					<h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
						{t("healthPage.fleet.title")}
					</h2>
				</div>
				<span className="text-xs text-[var(--text-muted)]">
					{tt("healthPage.fleet.basedOn", { count: onlineServers.length })}
				</span>
			</div>
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<FleetMetricBar label={t("healthPage.fleet.avgCpu")} value={avgCpu} unit="%" />
				<FleetMetricBar label={t("healthPage.fleet.avgMem")} value={avgMem} unit="%" />
				<FleetMetricBar label={t("healthPage.fleet.avgDisk")} value={avgDisk} unit="%" />
				<div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
					<p className="text-xs uppercase  text-[var(--text-muted)]">
						{t("healthPage.fleet.avgLoad")}
					</p>
					<p className="mt-1 text-xl font-bold text-[var(--text-primary)]">{avgLoad}</p>
				</div>
			</div>
			<div className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
				<span>
					{t("healthPage.fleet.netIn")}:{" "}
					<strong className="text-[var(--text-primary)]">{fmtKbps(netInTotal)}</strong>
				</span>
				<span>
					{t("healthPage.fleet.netOut")}:{" "}
					<strong className="text-[var(--text-primary)]">{fmtKbps(netOutTotal)}</strong>
				</span>
			</div>
			{top5.length > 0 && (
				<div className="space-y-1.5">
					<p className="text-xs uppercase  text-[var(--text-muted)]">
						{t("healthPage.fleet.top5")}
					</p>
					{top5.map((s, i) => {
						const score = (s.cpu ?? 0) + (s.mem ?? 0) + (s.diskMax ?? 0);
						return (
							<div key={s.serverId} className="flex items-center gap-2 text-xs">
								<span className="w-4 text-[var(--text-muted)]">{i + 1}.</span>
								<span className="min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]">
									{s.serverName}
								</span>
								<span className={usageColor(s.cpu)}>CPU {s.cpu ?? "-"}%</span>
								<span className={usageColor(s.mem)}>MEM {s.mem ?? "-"}%</span>
								<span className={usageColor(s.diskMax)}>DISK {s.diskMax ?? "-"}%</span>
								<span className="text-[var(--text-muted)]">({score})</span>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
