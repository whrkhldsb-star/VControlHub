"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";

type Props = {
	templateId: string;
	variables: Record<string, string> | null;
	serverIds: string[];
	reason: string;
	label?: string;
};

export function ResendDeployButton({ templateId, variables, serverIds, reason, label }: Props) {
	const router = useRouter();
	const { t } = useI18n();
	const { addToast } = useToast();
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
			addToast("success", t("deploymentsPage.resend.toast.success"));
			router.refresh();
		} catch (err) {
			const msg = err instanceof Error ? err.message : t("deploymentsPage.resend.toast.failed");
			setError(msg);
			addToast("error", msg);
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
				data-tone="cyan" data-action-button data-variant="outline" className="!px-3 !py-1.5 !text-xs disabled:opacity-60"
			>
				{pending ? t("deploymentsPage.resend.submitting") : (label || t("deploymentsPage.resend.triggerBtn"))}
			</button>
			{error && <span role="alert" className="text-xs text-[var(--danger)]">{error}</span>}
		</div>
	);
}
