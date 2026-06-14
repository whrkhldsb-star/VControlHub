"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";

type Props = {
	templateId: string;
	variables: Record<string, string> | null;
	serverIds: string[];
	reason: string;
	label?: string;
};

export function ResendDeployButton({ templateId, variables, serverIds, reason, label }: Props) {
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleResend() {
		setPending(true);
		setError(null);
		try {
			await csrfFetch("/api/deployments", {
				method: "POST",
				body: JSON.stringify({ templateId, variables, serverIds, reason }),
			});
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "重发失败");
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-2">
			<button
				type="button"
				onClick={handleResend}
				disabled={pending}
				data-tone="cyan" className="rounded-lg border border-cyan-400/30 px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-60"
			>
				{pending ? "提交中..." : (label || "按此记录重发")}
			</button>
			{error && <span className="text-xs text-rose-300">{error}</span>}
		</div>
	);
}
