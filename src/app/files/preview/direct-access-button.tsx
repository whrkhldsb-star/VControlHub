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
	onUrlReady,
}: {
	nodeId: string;
	relativePath: string;
	driver: string;
	fileName: string;
	onUrlReady: (url: string) => void;
}) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [activeMode, setActiveMode] = useState<"managed-download" | "direct-url" | null>(null);
	const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

	const requestAccess = useCallback(async (prefer: "auto" | "proxy") => {
		setLoading(true);
		setError(null);

		try {
			const data = await csrfFetch("/api/storage/direct-access", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ nodeId, relativePath }),
			}) as DirectAccessResponse;

			if (data.fallbackUrl) setFallbackUrl(data.fallbackUrl);

			if (prefer === "proxy" && data.fallbackUrl) {
				onUrlReady(data.fallbackUrl);
				setActiveMode("managed-download");
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
			setLoading(false);
		}
	}, [nodeId, relativePath, onUrlReady]);

	if (driver !== "SFTP") return null;

	return (
		<div className="flex flex-wrap items-center gap-3">
			<button
				type="button"
				onClick={() => requestAccess("auto")}
				disabled={loading}
				className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
			>
				{loading ? "正在准备播放地址…" : "按节点设置播放"}
			</button>
			{fallbackUrl ? (
				<button
					type="button"
					onClick={() => requestAccess("proxy")}
					disabled={loading}
					className="rounded-full border border-slate-500/40 bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700 disabled:opacity-50"
				>
					强制网站中转
				</button>
			) : null}
			{activeMode ? (
				<span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-100">
					✅ 当前：{activeMode === "direct-url" ? "存储服务器直连" : "网站服务器中转"}
				</span>
			) : null}
			{error ? <span className="text-xs text-red-300">{error}</span> : null}
		</div>
	);
}
