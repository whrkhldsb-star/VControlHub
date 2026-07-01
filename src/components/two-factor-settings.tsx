"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type Step = "idle" | "setup" | "verify" | "disable";

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
	const { t } = useI18n();
	const router = useRouter();
	const [step, setStep] = useState<Step>("idle");
	const [secret, setSecret] = useState("");
	const [otpauthUrl, setOtpauthUrl] = useState("");
	const [code, setCode] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	// QR code rendered via Google Charts API (replaces canvas placeholder)

	const messageFromError = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback;

	const handleSetup = async () => {
		setLoading(true);
		setError("");
		try {
			const data = await csrfFetch("/api/auth/2fa/setup", { method: "POST" });
			if (data.error) { setError(data.error); return; }
			setSecret(data.secret);
			setOtpauthUrl(data.otpauthUrl);
			setStep("setup");
		} catch (err) { setError(messageFromError(err, t("auth.2fa-error-request-failed"))); }
		finally { setLoading(false); }
	};

	const handleVerify = async () => {
		if (code.length !== 6) { setError(t("auth.2fa-error-code-length")); return; }
		setLoading(true);
		setError("");
		try {
			// First verify the code
			const verifyData = await csrfFetch("/api/auth/2fa/setup", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code, secret }),
			});
			if (!verifyData.valid) { setError(t("auth.2fa-error-invalid-code")); return; }

			// Then enable 2FA
			const enableData = await csrfFetch("/api/auth/2fa/enable", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code, secret }),
			});
			if (enableData.error) { setError(enableData.error); return; }
			setStep("idle");
			router.refresh();
		} catch (err) { setError(messageFromError(err, t("auth.2fa-error-request-failed"))); }
		finally { setLoading(false); }
	};

	const handleDisable = async () => {
		if (code.length !== 6) { setError(t("auth.2fa-error-code-length")); return; }
		setLoading(true);
		setError("");
		try {
			const data = await csrfFetch("/api/auth/2fa/disable", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code }),
			});
			if (data.error) { setError(data.error); return; }
			setStep("idle");
			router.refresh();
		} catch (err) { setError(messageFromError(err, t("auth.2fa-error-request-failed"))); }
		finally { setLoading(false); }
	};

	return (
		<div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-5">
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-sm font-medium text-[var(--text-primary)]">{t("auth.2fa-section-title")}</h3>
				<span className={`text-xs px-2 py-0.5 rounded-full ${enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-[var(--surface-hover)]/50 text-[var(--text-muted)]"}`}>
					{enabled ? t("auth.2fa-enabled") : t("auth.2fa-disabled")}
				</span>
			</div>

			{error && (
				<div role="alert" className="mb-3 text-xs text-rose-400 bg-rose-500/10 rounded-lg px-3 py-2">{error}</div>
			)}

			{step === "idle" && !enabled && (
				<div>
					<p className="text-xs text-[var(--text-secondary)] mb-3">
						{t("auth.2fa-setup-description")}
					</p>
					<button
						onClick={handleSetup}
						disabled={loading}
						className="px-4 py-2 text-xs font-medium bg-[var(--color-action)]/10 text-[var(--color-action)] rounded-lg hover:bg-[var(--color-action)]/20 transition disabled:opacity-50"
					>
						{loading ? t("auth.2fa-generating") : t("auth.2fa-enable")}
					</button>
				</div>
			)}

			{step === "idle" && enabled && (
				<div>
					<p className="text-xs text-[var(--text-secondary)] mb-3">
						{t("auth.2fa-disable-description")}
					</p>
					<button
						onClick={() => { setStep("disable"); setCode(""); setError(""); }}
						className="px-4 py-2 text-xs font-medium bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 transition"
					>
						{t("auth.2fa-disable")}
					</button>
				</div>
			)}

			{step === "setup" && (
				<div className="space-y-4">
					<p className="text-xs text-[var(--text-secondary)]">
						{t("auth.2fa-scan-qr-instruction")}
					</p>
					<Image
						src={`https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(otpauthUrl)}`}
						alt="2FA QR Code"
						className="mx-auto rounded-lg border border-[var(--border-subtle)]"
						width={200}
						height={200}
						unoptimized
					/>
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
							className="flex-1 px-3 py-2 text-sm bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
						/>
						<button
							onClick={handleVerify}
							disabled={loading || code.length !== 6}
							className="px-4 py-2 text-xs font-medium bg-[var(--color-action)]/10 text-[var(--color-action)] rounded-lg hover:bg-[var(--color-action)]/20 transition disabled:opacity-50"
						>
							{loading ? t("auth.2fa-verifying") : t("auth.2fa-confirm-enable")}
						</button>
					</div>
					<button
						onClick={() => { setStep("idle"); setCode(""); setError(""); }}
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
						{t("auth.2fa-current-code-label")}
					</label>
					<div className="flex gap-2">
						<input
							id="two-factor-disable-code"
							type="text"
							maxLength={6}
							value={code}
							onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
							placeholder="000000"
							className="flex-1 px-3 py-2 text-sm bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
						/>
						<button
							onClick={handleDisable}
							disabled={loading || code.length !== 6}
							className="px-4 py-2 text-xs font-medium bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 transition disabled:opacity-50"
						>
							{loading ? t("auth.2fa-verifying") : t("auth.2fa-confirm-disable")}
						</button>
					</div>
					<button
						onClick={() => { setStep("idle"); setCode(""); setError(""); }}
						className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition"
					>
						{t("auth.2fa-cancel")}
					</button>
				</div>
			)}
		</div>
	);
}
