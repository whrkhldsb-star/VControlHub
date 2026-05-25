"use client";

import { useState, useCallback } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

type DirectAccessResponse = {
  fallbackUrl?: string;
  url?: string;
  error?: string;
  mode?: "managed-download" | "direct-url" | string;
};

export function DirectAccessButton({
  nodeId,
  relativePath,
  driver,
  fileName,
  onUrlReady,
}: {
  nodeId: string;
  relativePath: string;
  driver: string;
  fileName: string;
  onUrlReady: (url: string) => void;
}) {
  const [loadingMode, setLoadingMode] = useState<"direct" | "proxy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<"managed-download" | "direct-url" | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const requestAccess = useCallback(async (prefer: "direct" | "proxy") => {
    setLoadingMode(prefer);
    setError(null);

    try {
      const data = await csrfFetch("/api/storage/direct-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId, relativePath }),
      }) as DirectAccessResponse;

      if (data.fallbackUrl) setFallbackUrl(data.fallbackUrl);

      if (prefer === "proxy") {
        if (data.fallbackUrl) {
          onUrlReady(data.fallbackUrl);
          setActiveMode("managed-download");
          return;
        }
        setError("服务端未返回可用的网站中转播放地址");
        return;
      }

      if (data.mode === "direct-url" && data.url) {
        onUrlReady(data.url);
        setActiveMode("direct-url");
        return;
      }

      if (data.fallbackUrl) {
        onUrlReady(data.fallbackUrl);
        setActiveMode("managed-download");
        return;
      }

      if (data.error) {
        setError(data.error ?? "请求播放地址失败");
        return;
      }

      setError("服务端未返回可用的播放地址");
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoadingMode(null);
    }
  }, [nodeId, relativePath, onUrlReady]);

  if (driver !== "SFTP") return null;

  const isLoading = loadingMode !== null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2">
      <span className="text-xs text-slate-400">播放流量</span>
      <button
        type="button"
        onClick={() => requestAccess("proxy")}
        disabled={isLoading}
        aria-label={`经网站服务器播放 ${fileName}`}
        className="rounded-full border border-slate-500/40 bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700 disabled:opacity-50"
      >
        {loadingMode === "proxy" ? "正在准备网站中转…" : "网站"}
      </button>
      <button
        type="button"
        onClick={() => requestAccess("direct")}
        disabled={isLoading}
        aria-label={`直连目标服务器播放 ${fileName}`}
        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
      >
        {loadingMode === "direct" ? "正在准备直连…" : "直连"}
      </button>
      {activeMode ? (
        <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-100">
          ✅ 当前：{activeMode === "direct-url" ? "目标服务器直连播放" : "网站服务器中转播放"}
        </span>
      ) : null}
      {fallbackUrl && activeMode === "direct-url" ? (
        <span className="text-[11px] text-slate-500">可随时切回网站中转</span>
      ) : null}
      {error ? <span className="text-xs text-red-300">{error}</span> : null}
    </div>
  );
}
