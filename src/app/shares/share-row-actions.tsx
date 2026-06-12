"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";

export function ShareRowActions({
	id,
	revoked,
}: {
	id: string;
	revoked: boolean;
}) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleRevoke() {
		if (busy) return;
		if (!window.confirm("撤销后该分享链接将立即失效且无法恢复，确认撤销？")) return;
		setBusy(true);
		setError(null);
		try {
			await csrfFetch(`/api/share-links?id=${encodeURIComponent(id)}`, { method: "DELETE" });
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "撤销失败");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex items-center gap-2">
			{!revoked ? (
				<button
					type="button"
					onClick={handleRevoke}
					disabled={busy}
					className="rounded-md border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-xs text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{busy ? "撤销中…" : "撤销"}
				</button>
			) : (
				<span className="text-xs text-slate-500">已撤销</span>
			)}
			{error ? <span role="alert" className="text-xs text-rose-300">{error}</span> : null}
		</div>
	);
}
