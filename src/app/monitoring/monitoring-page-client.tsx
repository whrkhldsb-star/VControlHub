"use client";

import { useCallback, useEffect, useState } from "react";
import { PageShell, PageHeader } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalFromStorage, getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";

interface Stats {
  hostname: string;
  platform: string;
  arch: string;
  uptime: string;
  cpu: { model: string; cores: number; usage: string; loadAvg: string[] };
  memory: { total: string; used: string; free: string; usagePercent: string };
  disk: string;
  network: { iface: string; rx: string; tx: string }[];
  topProcesses: { pid: string; cpu: string; mem: string; cmd: string }[];
  tcpConnections: string;
  timestamp: string;
}

function getMonitoringErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "监控接口暂时没有返回可用数据，请稍后重试。";
}

/** Card wrapper — extracted to module top to avoid re-creation on every render */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div data-card className="p-5">
      <h3 className="mb-3 text-xs font-medium text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

/** Key-value row — extracted to module top to avoid re-creation on every render */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="font-mono text-xs text-white">{value}</span>
    </div>
  );
}

export default function MonitoringPage({ canManage: _canManage }: { canManage: boolean }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(() =>
    typeof window === "undefined" ? 30 : getRefreshIntervalFromStorage(window.localStorage, 30),
  );

  const fetchStats = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await csrfFetch("/api/monitoring/stats") as Stats & { error?: string; message?: string };
      if (data.error) {
        setErrorMessage(data.error || data.message || "监控接口返回了错误。请稍后重试。");
        return;
      }
      setStats(data);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getMonitoringErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
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
    const timer = window.setTimeout(() => {
      void fetchStats();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchStats]);
  useEffect(() => {
    if (!autoRefresh || refreshIntervalSeconds <= 0) return;
    const id = setInterval(() => { void fetchStats(); }, refreshIntervalSeconds * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchStats, refreshIntervalSeconds]);

  if (loading) {
    return (
      <PageShell>
        <div className="text-sm text-slate-500">加载中...</div>
      </PageShell>
    );
  }

  if (!stats) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-5 text-sm text-rose-100">
          <h1 className="mb-2 text-xl font-semibold text-rose-50">无法获取监控数据</h1>
          <p className="text-rose-100/80/80">{errorMessage ?? "监控接口暂时没有返回可用数据，请稍后重试。"}</p>
          <button
            type="button"
            onClick={fetchStats}
            disabled={refreshing}
            className="mt-4 rounded-lg bg-rose-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? "重试中..." : "重试"}
          </button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader eyebrow="Monitoring" title="服务器监控" description="实时系统资源监控" className="mb-6" />

      {errorMessage ? (
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          上次刷新失败：{errorMessage}
        </div>
      ) : null}

      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={fetchStats}
          disabled={refreshing}
          className="rounded-lg bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-400 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? "刷新中..." : "刷新"}
        </button>
        <button
          type="button"
          onClick={() => setAutoRefresh(!autoRefresh)}
          disabled={refreshIntervalSeconds <= 0}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ?"bg-emerald-500/10 text-emerald-400" :"bg-slate-700/50 light:bg-slate-200/50 text-slate-400"}`}
        >
          {autoRefresh ? `● 自动刷新 (${getRefreshIntervalLabel(refreshIntervalSeconds)})` : refreshIntervalSeconds <= 0 ? "自动刷新已关闭" : `自动刷新 (${getRefreshIntervalLabel(refreshIntervalSeconds)})`}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card title="🖥️ 系统信息">
          <Row label="主机名" value={stats.hostname} />
          <Row label="平台" value={`${stats.platform} ${stats.arch}`} /> <Row label="运行时间" value={stats.uptime} /> </Card> <Card title="⚡ CPU"> <Row label="型号" value={stats.cpu.model.split("").slice(0, 3).join("")} /> <Row label="核心数" value={String(stats.cpu.cores)} /> <Row label="使用率" value={stats.cpu.usage} /> <Row label="负载 (1/5/15m)" value={stats.cpu.loadAvg.join(" /")} /> </Card> <Card title="💾 内存"> <Row label="总计" value={stats.memory.total} /> <Row label="已用" value={stats.memory.used} /> <Row label="可用" value={stats.memory.free} /> <div className="mt-2"> <div className="mb-1 flex justify-between text-[10px] text-slate-500"> <span>使用率</span><span>{stats.memory.usagePercent}%</span> </div> <div className="h-1.5 overflow-hidden rounded-full bg-slate-800 light:bg-slate-100"> <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width:`${stats.memory.usagePercent}%` }} />
            </div>
          </div>
        </Card>

        <Card title="💿 磁盘">
          <Row label="使用量" value={stats.disk} />
        </Card>

        <Card title="🌐 网络">
          {stats.network.length > 0 ? stats.network.map((n) => (
            <div key={n.iface} className="py-1.5">
              <div className="font-mono text-xs text-white">{n.iface}</div>
              <div className="text-[10px] text-slate-500">↓ {n.rx} ↑ {n.tx}</div>
            </div>
          )) : <Row label="无数据" value="-" />}
        </Card>

        <Card title="🔗 TCP 连接">
          <Row label="活跃连接" value={stats.tcpConnections} />
        </Card>
      </div>

      <Card title="📊 Top 进程 (按内存)">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-slate-500">
                <th className="py-2 text-left">PID</th>
                <th className="py-2 text-right">CPU%</th>
                <th className="py-2 text-right">MEM%</th>
                <th className="py-2 pl-4 text-left">命令</th>
              </tr>
            </thead>
            <tbody>
              {stats.topProcesses.map((p) => (
                <tr key={p.pid} className="border-b border-white/[0.03]">
                  <td className="py-1.5 font-mono text-slate-400">{p.pid}</td>
                  <td className="py-1.5 text-right text-amber-400">{p.cpu}</td>
                  <td className="py-1.5 text-right text-cyan-400">{p.mem}</td>
                  <td className="max-w-[200px] truncate py-1.5 pl-4 text-white">{p.cmd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-4 text-[10px] text-slate-600">最后更新: {stats.timestamp}</p>
    </PageShell>
  );
}
