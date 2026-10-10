"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";

export function ShareRowActions({
	id,
	revoked,
}: {
	id: string;
	revoked: boolean;
}) {
	const router = useRouter();
	const { t } = useI18n();
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
			await csrfFetch(`/api/share-links?id=${encodeURIComponent(id)}`, { method:"DELETE" });
			setConfirming(false);
			router.refresh();
		} catch (err) {
			setError(getErrorMessage(err, t("sharesPage.rowActions.fallback")));
		} finally {
			setBusy(false);
		}
	}

	if (revoked) {
		return <span className="text-xs text-[var(--text-muted)]">{t("sharesPage.rowActions.revokedLabel")}</span>;
	}

	return (
		<div className="flex flex-wrap items-center gap-2">
			{confirming ? (
				<span className="text-xs text-[var(--danger)]">{t("sharesPage.rowActions.warning")}</span>
			) : null}
			<ActionButton variant="danger"
				onClick={handleRevoke}
				disabled={busy}
				aria-describedby={confirming ? `revoke-share-${id}-warning` : undefined}
				size="sm"
			>
				{busy ? t("sharesPage.rowActions.submitting") : confirming ? t("sharesPage.rowActions.confirm") : t("sharesPage.rowActions.revoke")}
			</ActionButton>
			{confirming ? (
				<ActionButton
					size="sm"
					variant="secondary"
					onClick={() => {
						setConfirming(false);
						setError(null);
					}}
					disabled={busy}
				>
					{t("sharesPage.rowActions.cancel")}
				</ActionButton>
			) : null}
			{confirming ? <span id={`revoke-share-${id}-warning`} className="sr-only">{t("sharesPage.rowActions.confirmAria")}</span> : null}
			{error ? <span role="alert" className="text-xs text-[var(--danger)]">{error}</span> : null}
		</div>
	);
}
