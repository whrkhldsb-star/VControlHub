"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { isAcceptableTwoFactorCodeShape } from "@/lib/auth/two-factor-challenge-shape";
import { useI18n } from "@/lib/i18n/use-locale";

import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { getErrorMessage } from "@/lib/http/error-message";
type Step = "idle" | "setup" | "verify" | "disable" | "regenerate" | "recovery";

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
	const { t } = useI18n();
	const router = useRouter();
	const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
	const isEnabled = enabledOverride ?? enabled;
	const [step, setStep] = useState<Step>("idle");
	const [secret, setSecret] = useState("");
	// Signed ticket from /2fa/setup. The seed shown above is for the user's
	// authenticator; this is what actually authorises the enable call, so the
	// browser cannot substitute a seed of its own choosing.
	const [enrollmentToken, setEnrollmentToken] = useState("");
	const [qrDataUrl, setQrDataUrl] = useState("");
	const [code, setCode] = useState("");
	const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	const messageFromError = (err: unknown, fallback: string) => getErrorMessage(err, fallback);
	// Disable / regenerate accept an authenticator code OR a recovery code — a user
	// whose authenticator is gone has no other way off 2FA, and no admin can reset
	// it for them. Setup/enable stay 6-digit-only: they verify a brand-new seed.
	const secondFactorOk = isAcceptableTwoFactorCodeShape(code);

	const handleSetup = async () => {
		setLoading(true);
		setError("");
		try {
			const data = await csrfFetch("/api/auth/2fa/setup", { method: "POST" });
			if (data.error) { setError(data.error); return; }
			if (
				typeof data.secret !== "string" ||
				typeof data.qrDataUrl !== "string" ||
				typeof data.enrollmentToken !== "string"
			) {
				setError(t("auth.2fa-error-request-failed"));
				return;
			}
			setSecret(data.secret);
			setQrDataUrl(data.qrDataUrl);
			setEnrollmentToken(data.enrollmentToken);
			setStep("setup");
		} catch (err) { setError(messageFromError(err, t("auth.2fa-error-request-failed"))); }
		finally { setLoading(false); }
	};

	const handleVerify = async () => {
		if (code.length !== 6) { setError(t("auth.2fa-error-code-length")); return; }
		setLoading(true);
		setError("");
		try {
			// One call: /2fa/enable verifies the code against the seed inside the
			// enrollment ticket. The old pre-flight PUT verified the code against a
			// caller-supplied seed, which could not prove anything.
			const enableData = await csrfFetch("/api/auth/2fa/enable", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code, enrollmentToken }),
			});
			if (enableData.error) { setError(enableData.error); return; }
			if (!Array.isArray(enableData.recoveryCodes) || enableData.recoveryCodes.some((item: unknown) => typeof item !== "string")) {
				setError(t("auth.2fa-error-request-failed"));
				return;
			}
			setSecret("");
			setQrDataUrl("");
			setEnrollmentToken("");
			setCode("");
			setRecoveryCodes(enableData.recoveryCodes);
			setStep("recovery");
			setEnabledOverride(true);
			router.refresh();
		} catch (err) { setError(messageFromError(err, t("auth.2fa-error-request-failed"))); }
		finally { setLoading(false); }
	};

	const handleRegenerateRecoveryCodes = async () => {
		if (!secondFactorOk) { setError(t("auth.2fa-error-code-format")); return; }
		setLoading(true);
		setError("");
		try {
			const data = await csrfFetch("/api/auth/2fa/recovery-codes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code }),
			});
			if (data.error) { setError(data.error); return; }
			if (!Array.isArray(data.recoveryCodes) || data.recoveryCodes.some((item: unknown) => typeof item !== "string")) {
				setError(t("auth.2fa-error-request-failed"));
				return;
			}
			setCode("");
			setRecoveryCodes(data.recoveryCodes);
			setStep("recovery");
		} catch (err) { setError(messageFromError(err, t("auth.2fa-error-request-failed"))); }
		finally { setLoading(false); }
	};

	const handleDisable = async () => {
		if (!secondFactorOk) { setError(t("auth.2fa-error-code-format")); return; }
		setLoading(true);
		setError("");
		try {
			const data = await csrfFetch("/api/auth/2fa/disable", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code }),
			});
			if (data.error) { setError(data.error); return; }
			setSecret("");
			setQrDataUrl("");
			setEnrollmentToken("");
			setCode("");
			setStep("idle");
			setEnabledOverride(false);
			router.refresh();
		} catch (err) { setError(messageFromError(err, t("auth.2fa-error-request-failed"))); }
		finally { setLoading(false); }
	};

	return (
		<div id="2fa" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-5">
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-sm font-medium text-[var(--text-primary)]">{t("auth.2fa-section-title")}</h3>
				<StatusBadge tone={isEnabled ? "success" : "neutral"} size="sm">
					{isEnabled ? t("auth.2fa-enabled") : t("auth.2fa-disabled")}
				</StatusBadge>
			</div>

			{error && (
				<Notice tone="danger" compact>{error}</Notice>
			)}

			{step === "idle" && !isEnabled && (
				<div>
					<p className="text-xs text-[var(--text-secondary)] mb-3">
						{t("auth.2fa-setup-description")}
					</p>
					<ActionButton type="button" variant="ghost" onClick={handleSetup} disabled={loading} className="text-xs">
						{loading ? t("auth.2fa-generating") : t("auth.2fa-enable")}
					</ActionButton>
				</div>
			)}

			{step === "idle" && isEnabled && (
				<div>
					<p className="text-xs text-[var(--text-secondary)] mb-3">
						{t("auth.2fa-disable-description")}
					</p>
					<div className="flex flex-wrap gap-2">
						<ActionButton type="button" variant="secondary" onClick={() => { setStep("regenerate"); setCode(""); setError(""); }} className="text-xs">
							{t("auth.2fa-regenerate-recovery-codes")}
						</ActionButton>
						<ActionButton type="button" variant="danger" onClick={() => { setStep("disable"); setCode(""); setError(""); }} className="text-xs">
							{t("auth.2fa-disable")}
						</ActionButton>
					</div>
				</div>
			)}

			{step === "setup" && (
				<div className="space-y-4">
					<p className="text-xs text-[var(--text-secondary)]">
						{t("auth.2fa-scan-qr-instruction")}
					</p>
					{qrDataUrl ? (
						<Image
							src={qrDataUrl}
							alt="2FA QR Code"
							className="mx-auto rounded-lg border border-[var(--border-subtle)]"
							width={200}
							height={200}
							unoptimized
						/>
					) : null}
					<div className="bg-[var(--surface-subtle)] rounded-lg p-3 border border-[var(--border)]">
						<p className="text-[10px] text-[var(--text-muted)] mb-1">{t("auth.2fa-secret-label")}</p>
						<code className="text-xs text-[var(--color-action)] break-all select-all">{secret}</code>
					</div>
					<p className="text-xs text-[var(--text-secondary)]">
						{t("auth.2fa-enter-code-instruction")}
					</p>
					<label htmlFor="two-factor-setup-code" className="block text-xs font-medium text-[var(--text-secondary)]">
						{t("auth.2fa-code-label")}
					</label>
					<div className="flex gap-2">
						<input
							id="two-factor-setup-code"
							type="text"
							maxLength={6}
							value={code}
							onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
							placeholder="000000"
							className={cn(UI_INPUT, "flex-1")}
						/>
						<ActionButton type="button" onClick={handleVerify} disabled={loading || code.length !== 6} className="text-xs">
							{loading ? t("auth.2fa-verifying") : t("auth.2fa-confirm-enable")}
						</ActionButton>
					</div>
					<button
						type="button"
						onClick={() => { setStep("idle"); setCode(""); setError(""); setQrDataUrl(""); setSecret(""); setEnrollmentToken(""); }}
						className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition"
					>
						{t("auth.2fa-cancel")}
					</button>
				</div>
			)}

			{step === "disable" && (
				<div className="space-y-4">
					<p className="text-xs text-[var(--text-secondary)]">{t("auth.2fa-disable-instruction")}</p>
					<label htmlFor="two-factor-disable-code" className="block text-xs font-medium text-[var(--text-secondary)]">
						{t("auth.2fa-code-or-recovery-label")}
					</label>
					<div className="flex gap-2">
						<input
							id="two-factor-disable-code"
							type="text"
							maxLength={19}
							value={code}
							onChange={(e) => setCode(e.target.value)}
							placeholder={t("auth.2fa-code-or-recovery-placeholder")}
							className={cn(UI_INPUT, "flex-1")}
						/>
						<button
							type="button"
							onClick={handleDisable}
							disabled={loading || !secondFactorOk}
							className="px-4 py-2 text-xs font-medium bg-[var(--danger-bg)] text-[var(--danger)] rounded-lg hover:bg-[var(--danger-bg)] transition disabled:opacity-50"
						>
							{loading ? t("auth.2fa-verifying") : t("auth.2fa-confirm-disable")}
						</button>
					</div>
					<button
						type="button"
						onClick={() => { setStep("idle"); setCode(""); setError(""); }}
						className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition"
					>
						{t("auth.2fa-cancel")}
					</button>
				</div>
			)}

			{step === "regenerate" && (
				<div className="space-y-4">
					<p className="text-xs text-[var(--text-secondary)]">{t("auth.2fa-regenerate-recovery-description")}</p>
					<label htmlFor="two-factor-regenerate-code" className="block text-xs font-medium text-[var(--text-secondary)]">
						{t("auth.2fa-code-or-recovery-label")}
					</label>
					<div className="flex gap-2">
						<input
							id="two-factor-regenerate-code"
							type="text"
							maxLength={19}
							value={code}
							onChange={(e) => setCode(e.target.value)}
							placeholder={t("auth.2fa-code-or-recovery-placeholder")}
							className={cn(UI_INPUT, "flex-1")}
						/>
						<ActionButton type="button" onClick={handleRegenerateRecoveryCodes} disabled={loading || !secondFactorOk} className="text-xs">
							{loading ? t("auth.2fa-verifying") : t("auth.2fa-regenerate-recovery-codes")}
						</ActionButton>
					</div>
					<button type="button" onClick={() => { setStep("idle"); setCode(""); setError(""); }} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition">
						{t("auth.2fa-cancel")}
					</button>
				</div>
			)}

			{step === "recovery" && (
				<div className="space-y-4">
					<div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--text-secondary)]">
						{t("auth.2fa-recovery-warning")}
					</div>
					<div>
						<p className="text-xs font-medium text-[var(--text-primary)]">{t("auth.2fa-recovery-title")}</p>
						<p className="mt-1 text-xs text-[var(--text-secondary)]">{t("auth.2fa-recovery-description")}</p>
					</div>
					<div className="grid gap-2 sm:grid-cols-2">
						{recoveryCodes.map((recoveryCode) => (
							<code key={recoveryCode} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-center text-sm font-semibold tracking-wide text-[var(--text-primary)] select-all">
								{recoveryCode}
							</code>
						))}
					</div>
					<div className="flex flex-wrap gap-2">
						<ActionButton
							type="button"
							variant="secondary"
							onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n"))}
							className="text-xs"
						>
							{t("auth.2fa-recovery-copy")}
						</ActionButton>
						<ActionButton type="button" onClick={() => { setRecoveryCodes([]); setStep("idle"); }} className="text-xs">
							{t("auth.2fa-recovery-saved")}
						</ActionButton>
					</div>
				</div>
			)}
		</div>
	);
}
