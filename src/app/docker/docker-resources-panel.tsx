"use client";

import { useCallback, useEffect, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

type ResourceType = "networks" | "volumes";

type DockerNetwork = { Id?: string; Name: string; Driver?: string; Scope?: string };
type DockerVolume = { Name: string; Driver?: string; Mountpoint?: string; Scope?: string };

type DetailState = { title: string; json: string } | null;

function resourceName(item: DockerNetwork | DockerVolume) {
  return "Name" in item ? item.Name : "";
}

function resourceMeta(item: DockerNetwork | DockerVolume) {
  const parts = [item.Driver, "Scope" in item ? item.Scope : undefined].filter(Boolean);
  return parts.join(" · ") || "local";
}

export function DockerResourcesPanel() {
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [activeType, setActiveType] = useState<ResourceType>("networks");
  const [name, setName] = useState("");
  const [driver, setDriver] = useState("local");
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<DetailState>(null);

  const fetchResources = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [networkData, volumeData] = await Promise.all([
        csrfFetch("/api/docker/resources?type=networks"),
        csrfFetch("/api/docker/resources?type=volumes"),
      ]);
      if (networkData.error) throw new Error(networkData.error);
      if (volumeData.error) throw new Error(volumeData.error);
      setNetworks(Array.isArray(networkData.data) ? networkData.data : []);
      const volumePayload = volumeData.data as { Volumes?: DockerVolume[] } | DockerVolume[] | undefined;
      setVolumes(Array.isArray(volumePayload) ? volumePayload : volumePayload?.Volumes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Docker 资源加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchResources();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchResources]);

  async function createResource() {
    const cleanName = name.trim();
    if (!cleanName) return;
    setBusyKey(`create:${activeType}`);
    setError("");
    try {
      const data = await csrfFetch("/api/docker/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: activeType, action: "create", name: cleanName, driver: driver.trim() || "local" }),
      });
      if (data.error) throw new Error(data.error);
      setName("");
      await fetchResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Docker 资源创建失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function inspectResource(type: ResourceType, itemName: string) {
    setBusyKey(`inspect:${type}:${itemName}`);
    setError("");
    try {
      const data = await csrfFetch(`/api/docker/resources?type=${type}&name=${encodeURIComponent(itemName)}`);
      if (data.error) throw new Error(data.error);
      setDetail({ title: `${type === "networks" ? "Network" : "Volume"}: ${itemName}`, json: JSON.stringify(data.data, null, 2) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Docker 资源详情加载失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteResource(type: ResourceType, itemName: string) {
    if (!window.confirm(`确认删除 ${type === "networks" ? "Network" : "Volume"} ${itemName}？`)) return;
    setBusyKey(`delete:${type}:${itemName}`);
    setError("");
    try {
      const data = await csrfFetch("/api/docker/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, action: "delete", name: itemName }),
      });
      if (data.error) throw new Error(data.error);
      await fetchResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Docker 资源删除失败");
    } finally {
      setBusyKey(null);
    }
  }

  function renderList(type: ResourceType, items: Array<DockerNetwork | DockerVolume>) {
    return (
      <div className="space-y-2">
        {items.length === 0 ? <p className="text-xs text-[var(--text-muted)]">暂无 {type === "networks" ? "Network" : "Volume"}</p> : null}
        {items.map((item) => {
          const itemName = resourceName(item);
          const key = `${type}:${itemName}`;
          return (
            <div key={key} className="rounded-xl border border-[var(--border)] bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{itemName}</p>
                  <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{resourceMeta(item)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" aria-label={`Inspect ${type === "networks" ? "Network" : "Volume"} ${itemName}`} onClick={() => inspectResource(type, itemName)} disabled={busyKey === `inspect:${key}`} className="min-h-10 rounded-lg bg-[var(--color-action)]/10 px-3 py-1 text-xs text-[var(--color-action)] transition hover:bg-[var(--color-action)]/20 disabled:opacity-50">Inspect</button>
                  <button type="button" aria-label={`删除 ${type === "networks" ? "Network" : "Volume"} ${itemName}`} onClick={() => deleteResource(type, itemName)} disabled={busyKey === `delete:${key}`} className="min-h-10 rounded-lg bg-rose-500/10 px-3 py-1 text-xs text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50">删除</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section data-card className="mb-6 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Docker Network / Volume</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">管理本机 Docker socket 上的网络与数据卷。</p>
        </div>
        <button type="button" onClick={() => void fetchResources()} disabled={loading} className="min-h-11 rounded-lg bg-[var(--surface-hover)]/50 px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] disabled:opacity-50">{loading ? "刷新中..." : "刷新资源"}</button>
      </div>
      {error ? <div className="mb-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div> : null}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <select value={activeType} onChange={(event) => setActiveType(event.currentTarget.value as ResourceType)} className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text-primary)]"><option value="networks">Network</option><option value="volumes">Volume</option></select>
        <input value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="名称" className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
        <input value={driver} onChange={(event) => setDriver(event.currentTarget.value)} placeholder="driver" className="min-h-11 w-28 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
        <button type="button" onClick={() => void createResource()} disabled={!name.trim() || Boolean(busyKey)} data-tone="accent" className="min-h-11 rounded-lg border px-4 py-2 text-sm font-medium transition disabled:opacity-50">创建</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div><h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Networks ({networks.length})</h3>{renderList("networks", networks)}</div>
        <div><h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Volumes ({volumes.length})</h3>{renderList("volumes", volumes)}</div>
      </div>
      {detail ? <div className="mt-4 rounded-xl border border-[var(--border)] bg-black/50 p-3"><div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-medium text-[var(--text-primary)]">{detail.title}</h3><button type="button" onClick={() => setDetail(null)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">关闭</button></div><pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{detail.json}</pre></div> : null}
    </section>
  );
}
