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
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleRevoke() {
		if (busy) return;
		if (!confirming) {
			setError(null);
			setConfirming(true);
			return;
		}

		setBusy(true);
		setError(null);
		try {
			await csrfFetch(`/api/share-links?id=${encodeURIComponent(id)}`, { method: "DELETE" });
			setConfirming(false);
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "撤销失败");
		} finally {
			setBusy(false);
		}
	}

	if (revoked) {
		return <span className="text-xs text-slate-500">已撤销</span>;
	}

	return (
		<div className="flex flex-wrap items-center gap-2">
			{confirming ? (
				<span className="text-xs text-rose-200">撤销后该分享链接将立即失效且无法恢复。</span>
			) : null}
			<button
				type="button"
				onClick={handleRevoke}
				disabled={busy}
				aria-describedby={confirming ? `revoke-share-${id}-warning` : undefined}
				data-tone="rose" className="min-h-11 min-w-11 rounded-lg border border-rose-400/30 px-2.5 py-1 text-xs text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{busy ? "撤销中…" : confirming ? "确认撤销" : "撤销"}
			</button>
			{confirming ? (
				<button
					type="button"
					onClick={() => {
						setConfirming(false);
						setError(null);
					}}
					disabled={busy}
					className="min-h-11 min-w-11 rounded-lg border border-[var(--border)] bg-white/5 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
				>
					取消
				</button>
			) : null}
			{confirming ? <span id={`revoke-share-${id}-warning`} className="sr-only">确认撤销分享链接</span> : null}
			{error ? <span role="alert" className="text-xs text-rose-300">{error}</span> : null}
		</div>
	);
}
