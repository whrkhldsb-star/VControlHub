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
    <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-950/70 p-3 shadow-sm light:border-slate-200 light:bg-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium text-slate-300 light:text-slate-700">
            播放路径
          </p>
          <p className="mt-1 text-[11px] text-slate-500 light:text-slate-500">
            网站中转更稳定；直连依赖目标服务器公网网关。
          </p>
        </div>
        <div className="inline-flex overflow-hidden rounded-xl border border-white/10 bg-slate-900 p-1 light:border-slate-200 light:bg-slate-100">
          <button
            type="button"
            onClick={() => requestAccess("proxy")}
            disabled={isLoading}
            aria-pressed={activeMode === "managed-download"}
            aria-label={`经网站服务器播放 ${fileName}`}
            className={`rounded-lg px-3 py-1.5 text-sm transition disabled:opacity-50 ${
              activeMode === "managed-download"
                ? "bg-cyan-500 text-white shadow-sm"
                : "text-slate-300 hover:bg-white/10 hover:text-white light:text-slate-700 light:hover:bg-white"
            }`}
          >
            {loadingMode === "proxy" ? "准备中" : "网站中转"}
          </button>
          <button
            type="button"
            onClick={() => requestAccess("direct")}
            disabled={isLoading}
            aria-pressed={activeMode === "direct-url"}
            aria-label={`直连目标服务器播放 ${fileName}`}
            className={`rounded-lg px-3 py-1.5 text-sm transition disabled:opacity-50 ${
              activeMode === "direct-url"
                ? "bg-cyan-500 text-white shadow-sm"
                : "text-slate-300 hover:bg-white/10 hover:text-white light:text-slate-700 light:hover:bg-white"
            }`}
          >
            {loadingMode === "direct" ? "准备中" : "目标直连"}
          </button>
        </div>
      </div>
      <div className="mt-2 min-h-5 text-xs">
        {activeMode ? (
          <span className="text-cyan-200 light:text-cyan-700">
            当前：{activeMode === "direct-url" ? "目标服务器直连播放" : "网站服务器中转播放"}
          </span>
        ) : fallbackUrl ? (
          <span className="text-slate-500">可随时切回网站中转</span>
        ) : null}
        {error ? <span className="text-red-300 light:text-red-700">{error}</span> : null}
      </div>
    </div>
  );
}
