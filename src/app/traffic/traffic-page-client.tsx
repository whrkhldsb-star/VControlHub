"use client";

import { useCallback, useEffect, useState } from "react";

import { PageShell, PageHeader } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalFromStorage, getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";

type InterfaceTraffic = {
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

type RemoteServerTraffic = {
	serverId: string;
	serverName: string;
	host: string;
	primaryInterface: InterfaceTraffic | null;
	interfaces: InterfaceTraffic[];
	sampledAt: string;
	error: string | null;
};

type TrafficSummary = {
	timestamp: string;
	currentServer: {
		name: string;
		primaryInterface: InterfaceTraffic | null;
		interfaces: InterfaceTraffic[];
	};
	storageNodes: Array<{
		id: string;
		name: string;
		driver: string;
		serverId?: string | null;
		host?: string | null;
		port?: number | null;
		healthStatus: string;
		trafficSource: string;
		trafficSourceLabel: string;
		trafficSourceDetail: string;
		remoteServerId?: string | null;
		server?: { id: string; name: string; host: string; port: number } | null;
	}>;
	remoteServers?: RemoteServerTraffic[];
	servers: Array<{ id: string; name: string; host: string; port: number }>;
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
	return <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"> <h2 className="mb-4 text-sm font-medium text-[var(--text-secondary)]">{title}</h2>{children}</section>;
}

function RateBadge({ label, value, color }: { label: string; value: string; color: "cyan" | "emerald" }) {
	const styles = color === "cyan" ? "bg-cyan-500/10 text-cyan-300" : "bg-emerald-500/10 text-emerald-300";
	return <div className={`rounded-xl px-4 py-3 ${styles}`}><div className="text-[11px] opacity-70">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{value}</div></div>;
}

export function formatStorageHealthStatus(t: (key: string) => string, status: string) {
	const normalized = status.trim().toUpperCase();
	if (normalized === "HEALTHY" || normalized === "ONLINE") return t("trafficPage.health.online");
	if (normalized === "WARNING") return t("trafficPage.health.attention");
	if (normalized === "CRITICAL" || normalized === "OFFLINE") return t("trafficPage.health.abnormal");
	if (normalized === "UNKNOWN" || normalized === "") return t("trafficPage.health.unsampled");
	return status;
}

export default function TrafficPage({ canManage: _canManage }: { canManage: boolean }) {
	const { t } = useI18n();
	const [summary, setSummary] = useState<TrafficSummary | null>(null);
	const [remoteServers, setRemoteServers] = useState<RemoteServerTraffic[] | null>(null);
	const [remoteLoading, setRemoteLoading] = useState(false);
	const [selectedIface, setSelectedIface] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [autoRefresh, setAutoRefresh] = useState(true);
	const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(() =>
		typeof window === "undefined" ? 30 : getRefreshIntervalFromStorage(window.localStorage, 30),
	);

	const fetchSummary = useCallback(async (iface = selectedIface) => {
		try {
			const params = new URLSearchParams();
			if (iface) params.set("iface", iface);
			const data = await csrfFetch(`/api/traffic/summary${params.toString() ? `?${params}` : ""}`) as TrafficSummary & { error?: string };
			if (data.error) {
				setError(data.error);
				return;
			}
			setSummary(data);
			setError("");
		} catch {
			setError(t("trafficPage.error.fetch"));
		} finally {
			setLoading(false);
		}
	}, [selectedIface, t]);

	// Remote VPS sampling is its own request — it can take 5-15 s when SSH
	// hosts are slow, so we don't block first paint of the page on it.
	const fetchRemote = useCallback(async () => {
		setRemoteLoading(true);
		try {
			const data = await csrfFetch(`/api/traffic/summary?include=remote`) as TrafficSummary & { error?: string };
			if (data.error) return;
			setRemoteServers(data.remoteServers ?? []);
		} catch {
			// Soft-fail — keep whatever stale samples we already have.
		} finally {
			setRemoteLoading(false);
		}
	}, []);

	useEffect(() => {
		const onStorage = () => setRefreshIntervalSeconds(getRefreshIntervalFromStorage(globalThis.localStorage, 30));
		window.addEventListener("storage", onStorage);
		window.addEventListener("vps-preferences-updated", onStorage);
		return () => {
			window.removeEventListener("storage", onStorage);
			window.removeEventListener("vps-preferences-updated", onStorage);
		};
	}, []);

	useEffect(() => {
		const timer = setTimeout(() => { void fetchSummary(); }, 0);
		return () => clearTimeout(timer);
	}, [fetchSummary]);
	// Kick off remote sampling once on mount, then on every auto-refresh tick.
	// eslint-disable-next-line react-hooks/set-state-in-effect -- mount 时触发远端采样属于"订阅外部系统"的语义,fetchRemote 内部 setRemoteLoading 是异步 setState 不会级联渲染
	useEffect(() => { void fetchRemote(); }, [fetchRemote]);
	useEffect(() => {
		if (!autoRefresh || refreshIntervalSeconds <= 0) return;
		const id = setInterval(() => {
			void fetchSummary();
			void fetchRemote();
		}, refreshIntervalSeconds * 1000);
		return () => clearInterval(id);
	}, [autoRefresh, fetchSummary, fetchRemote, refreshIntervalSeconds]);

	const primary = summary?.currentServer.primaryInterface ?? null;
	const refreshLabel = getRefreshIntervalLabel(refreshIntervalSeconds);

	return (
		<PageShell>
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<PageHeader eyebrow={t("trafficPage.eyebrow")} title={t("trafficPage.title")} />
					<p className="text-sm text-[var(--text-secondary)]">{t("trafficPage.desc")}</p>
				</div>
				<div className="flex items-center gap-2">
					<button onClick={() => fetchSummary()} className="rounded-lg bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20">{t("trafficPage.refresh")}</button>
					<button onClick={() => setAutoRefresh((v) => !v)} disabled={refreshIntervalSeconds <= 0} className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-700/60 text-slate-300"}`}>
						{autoRefresh
							? t("trafficPage.autoRefreshOn").replace("{label}", refreshLabel)
							: refreshIntervalSeconds <= 0
								? t("trafficPage.autoRefreshOff")
								: t("trafficPage.autoRefreshPaused").replace("{label}", refreshLabel)}
					</button>
				</div>
			</div>

			{error && <div className="mb-4 rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}

			<div className="space-y-5">
				<Card title={t("trafficPage.card.realtime")}>
					{loading && !summary ? (
						<div className="text-sm text-slate-500">{t("trafficPage.loading")}</div>
					) : summary ? (
						<>
							<div className="mb-4 flex flex-wrap items-center gap-3">
								<label className="text-xs text-slate-500" htmlFor="trafficIface">{t("trafficPage.iface.label")}</label>
								<select id="trafficIface" value={selectedIface} onChange={(e) => setSelectedIface(e.target.value)} className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-1.5 text-xs text-slate-200">
										<option value="">{t("trafficPage.iface.auto")}</option>
										{summary.currentServer.interfaces.map((item) => <option key={item.iface} value={item.iface}>{item.iface}</option>)}
								</select>
								<span className="text-[11px] text-slate-600">{t("trafficPage.lastUpdated").replace("{date}", new Date(summary.timestamp).toLocaleString("zh-CN"))}</span>
							</div>
							{primary ? (
								<>
									<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
										<RateBadge label={t("trafficPage.rxRate").replace("{iface}", primary.iface)} value={primary.rxRateLabel} color="cyan" />
										<RateBadge label={t("trafficPage.txRate").replace("{iface}", primary.iface)} value={primary.txRateLabel} color="emerald" />
									</div>
									<div className="mt-4 grid grid-cols-1 gap-3 text-xs text-[var(--text-secondary)] md:grid-cols-2">
										<div className="rounded-xl bg-black/20 p-3 light:ring-1 light:ring-slate-200">{t("trafficPage.rxTotal").replace("{value}", primary.rxLabel)}<span className="font-mono text-slate-100"> </span></div>
										<div className="rounded-xl bg-black/20 p-3 light:ring-1 light:ring-slate-200">{t("trafficPage.txTotal").replace("{value}", primary.txLabel)}<span className="font-mono text-slate-100"> </span></div>
									</div>
								</>
							) : <div className="text-sm text-slate-500">{t("trafficPage.noIface")}</div>}
						</>
					) : null}
				</Card>

				<Card title={t("trafficPage.card.detail")}>
					{loading && !summary ? (
						<div className="text-sm text-slate-500">{t("trafficPage.loading")}</div>
					) : summary ? (
						<div className="overflow-x-auto">
							<table className="w-full text-xs">
								<thead className="text-slate-500"><tr><th className="py-2 text-left">{t("trafficPage.th.iface")}</th><th className="text-right">{t("trafficPage.th.rxRate")}</th><th className="text-right">{t("trafficPage.th.txRate")}</th><th className="text-right">{t("trafficPage.th.rxTotal")}</th><th className="text-right">{t("trafficPage.th.txTotal")}</th></tr></thead>
								<tbody>
									{summary.currentServer.interfaces.map((item) => <tr key={item.iface} className="border-t border-white/[0.04]"><td className="py-2 font-mono text-white">{item.iface}</td><td className="text-right text-cyan-300">{item.rxRateLabel}</td><td className="text-right text-emerald-300">{item.txRateLabel}</td><td className="text-right text-[var(--text-secondary)]">{item.rxLabel}</td><td className="text-right text-[var(--text-secondary)]">{item.txLabel}</td></tr>)}
								</tbody>
							</table>
						</div>
					) : null}
				</Card>

				<Card title={t("trafficPage.card.remote")}>
					{remoteLoading && !remoteServers ? (
						<div className="flex items-center gap-2 text-sm text-slate-500">
							<span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
							{t("trafficPage.remoteSampling")}
						</div>
					) : (remoteServers ?? []).length === 0 ? (
						<div className="text-sm text-slate-500">{t("trafficPage.noRemote")}</div>
					) : (
						<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
							{(remoteServers ?? []).map((node) => (
								<div key={node.serverId} className="rounded-xl border border-white/[0.05] bg-black/20 p-4">
									<div className="flex items-center justify-between gap-3">
										<div>
											<div className="text-sm font-medium text-white">{node.serverName}</div>
											<div className="mt-1 text-[11px] text-slate-500">{node.host}</div>
										</div>
										{node.error ? (
											<span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-300">{t("trafficPage.badge.samplingFailed")}</span>
										) : node.primaryInterface ? (
											<span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">{t("trafficPage.badge.onlineIface").replace("{iface}", node.primaryInterface.iface)}</span>
										) : (
											<span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] text-slate-300">{t("trafficPage.badge.noIface")}</span>
										)}
									</div>
									{node.error ? (
										<div className="mt-3 break-all text-[11px] text-rose-200/80">{node.error}</div>
									) : node.primaryInterface ? (
										<>
											<div className="mt-3 grid grid-cols-2 gap-2">
												<div className="rounded-lg bg-cyan-500/10 px-3 py-2 text-cyan-300">
													<div className="text-[10px] opacity-70">{t("trafficPage.rxShort")}</div>
													<div className="text-sm font-semibold tabular-nums">{node.primaryInterface.rxRateLabel}</div>
												</div>
												<div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-300">
													<div className="text-[10px] opacity-70">{t("trafficPage.txShort")}</div>
													<div className="text-sm font-semibold tabular-nums">{node.primaryInterface.txRateLabel}</div>
												</div>
											</div>
											<div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
												<div>{t("trafficPage.rxTotal").replace("{value}", node.primaryInterface.rxLabel)}<span className="font-mono text-slate-200"> </span></div>
												<div>{t("trafficPage.txTotal").replace("{value}", node.primaryInterface.txLabel)}<span className="font-mono text-slate-200"> </span></div>
											</div>
										</>
									) : (
										<div className="mt-3 text-[11px] text-slate-500">{t("trafficPage.noPrimaryIface")}</div>
									)}
								</div>
							))}
						</div>
					)}
				</Card>
			</div>
		</PageShell>
	);
}
