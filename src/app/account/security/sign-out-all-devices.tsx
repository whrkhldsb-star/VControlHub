"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";

/**
 * POST /api/auth/signout-all advances the account's session epoch, retiring
 * every session cookie on every device (stateless tokens cannot be revoked
 * one by one). This browser's cookies are cleared by the same call, hence the
 * redirect to /login.
 */
export function SignOutAllDevices() {
	const { t } = useI18n();
	const router = useRouter();
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const handleConfirm = async () => {
		setBusy(true);
		setError("");
		try {
			const data = await csrfFetch("/api/auth/signout-all", { method: "POST" });
			if (data.error) {
				setError(getErrorMessage(data, t("accountSecurity.signOutAllFailed")));
				setBusy(false);
				return;
			}
			router.push("/login");
			router.refresh();
		} catch (err) {
			setError(getErrorMessage(err, t("accountSecurity.signOutAllFailed")));
			setBusy(false);
		}
	};

	return (
		<div className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h3 className="text-sm font-semibold text-[var(--text-primary)]">
						{t("accountSecurity.signOutAllTitle")}
					</h3>
					<p className="mt-1 text-sm text-[var(--text-secondary)]">
						{t("accountSecurity.signOutAllDescription")}
					</p>
				</div>
				<ActionButton
					variant="warning"
					disabled={busy}
					onClick={() => setConfirming(true)}
					className="shrink-0"
				>
					{t("accountSecurity.signOutAllAction")}
				</ActionButton>
			</div>
			{error ? (
				<p role="alert" className="mt-2 text-sm text-[var(--danger)]">
					{error}
				</p>
			) : null}
			<ConfirmDialog
				open={confirming}
				title={t("accountSecurity.signOutAllConfirmTitle")}
				description={t("accountSecurity.signOutAllConfirmDescription")}
				confirmLabel={t("accountSecurity.signOutAllAction")}
				cancelLabel={t("common.cancel")}
				busy={busy}
				error={error || undefined}
				onConfirm={handleConfirm}
				onCancel={() => {
					if (!busy) setConfirming(false);
				}}
			/>
		</div>
	);
}
