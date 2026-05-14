"use client";

import { useState, useCallback } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

type DirectAccessResponse = {
	fallbackUrl?: string;
	error?: string;
	mode?: "managed-download" | string;
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
	const [directInfo, setDirectInfo] = useState<DirectAccessResponse | null>(null);

	const requestDirectAccess = useCallback(async () => {
		setLoading(true);
		setError(null);

		try {
			const data = await csrfFetch("/api/storage/direct-access", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ nodeId, relativePath }),
			}) as DirectAccessResponse;

			if (data.fallbackUrl) {
				setDirectInfo(data);
				onUrlReady(data.fallbackUrl);
				setError(null);
				return;
			}

			if (data.error) {
				setError(data.error ?? "请求中转播放失败");
				return;
			}

			setError("服务端未返回可用的中转播放地址");
		} catch (err) {
			setError(err instanceof Error ? err.message : "请求失败");
		} finally {
			setLoading(false);
		}
	}, [nodeId, relativePath, onUrlReady]);

	if (driver !== "SFTP") return null;

	return (
		<div className="flex flex-wrap items-center gap-3">
			{!directInfo?.fallbackUrl ? (
				<button
					type="button"
					onClick={requestDirectAccess}
					disabled={loading}
					className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
				>
					{loading ? "正在准备中转播放…" : "使用受控中转播放"}
				</button>
			) : (
				<span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-100">
					✅ 已切换到受控 SFTP 中转播放
				</span>
			)}
			{error ? <span className="text-xs text-red-300">{error}</span> : null}
		</div>
	);
}
