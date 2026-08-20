"use client";

import { useState, useRef, type KeyboardEvent, type ClipboardEvent } from "react";
import { useRouter } from "next/navigation";
import { StateBox } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type Verify2faFormProps = {
	nextPath: string;
	error?: string;
};

export function Verify2faForm({ nextPath, error }: Verify2faFormProps) {
	const { t } = useI18n();
	const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
	const [mode, setMode] = useState<"totp" | "recovery">("totp");
	const [recoveryCode, setRecoveryCode] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [errorMsg, setErrorMsg] = useState(error);
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
	const router = useRouter();

	function setDigit(index: number, value: string) {
		const newDigits = [...digits];
		newDigits[index] = value.slice(-1); // Only keep the last digit
		setDigits(newDigits);
		setErrorMsg(undefined);

		// Auto-focus next input
		if (value && index < 5) {
			inputRefs.current[index + 1]?.focus();
		}

		// Auto-submit when all 6 digits are filled
		if (value && index === 5 && newDigits.every((d) => d !== "")) {
			submitCode(newDigits.join(""));
		}
	}

	function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Backspace" && !digits[index] && index > 0) {
			inputRefs.current[index - 1]?.focus();
		}
	}

	function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
		e.preventDefault();
		const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
		if (!pasted) return;
		const newDigits = [...digits];
		for (let i = 0; i < pasted.length; i++) {
			newDigits[i] = pasted[i]!;
		}
		setDigits(newDigits);
		setErrorMsg(undefined);

		// Auto-submit if all filled
		if (newDigits.every((d) => d !== "")) {
			submitCode(newDigits.join(""));
		}
	}

	async function submitCode(code: string) {
		if (submitting) return;
		setSubmitting(true);
		setErrorMsg(undefined);

		try {

			const data = await csrfFetch("/api/auth/2fa/verify-login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code }),
			});
if (data.success) {
				const safe =
					typeof nextPath === "string" && nextPath.startsWith("/") && !nextPath.startsWith("//")
						? nextPath
						: "/";
				router.push(safe);
				return;
			}

			setErrorMsg(data.error || t("login.verify2faFailed"));
			if (mode === "totp") {
				setDigits(Array(6).fill(""));
				inputRefs.current[0]?.focus();
			}
		} catch {
			setErrorMsg(t("login.verify2faNetworkError"));
		} finally {
			setSubmitting(false);
		}
	}

	function handleResubmit(e: React.FormEvent) {
		e.preventDefault();
		const code = mode === "totp" ? digits.join("") : recoveryCode.trim();
		if ((mode === "totp" && code.length === 6) || (mode === "recovery" && code.length > 0)) {
			submitCode(code);
		}
	}

	return (
		<form onSubmit={handleResubmit} className="space-y-4">
			<div className="flex justify-center gap-2" role="group" aria-label={t("login.verify2faMethodLabel")}>
				<button
					type="button"
					aria-pressed={mode === "totp"}
					onClick={() => { setMode("totp"); setErrorMsg(undefined); }}
					className={`rounded-lg px-3 py-1.5 text-xs font-medium ${mode === "totp" ? "bg-[var(--accent-bg)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"}`}
				>
					{t("login.verify2faUseAuthenticator")}
				</button>
				<button
					type="button"
					aria-pressed={mode === "recovery"}
					onClick={() => { setMode("recovery"); setErrorMsg(undefined); }}
					className={`rounded-lg px-3 py-1.5 text-xs font-medium ${mode === "recovery" ? "bg-[var(--accent-bg)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"}`}
				>
					{t("login.verify2faUseRecovery")}
				</button>
			</div>

			{mode === "totp" ? (
			<div className="flex justify-center gap-2">
				{digits.map((digit, i) => (
					<input
						key={i}
						aria-label={t("login.verify2faDigitAria", { n: i + 1 })}
						ref={(el) => { inputRefs.current[i] = el; }}
						type="text"
						inputMode="numeric"
						pattern="[0-9]"
						maxLength={1}
						value={digit}
						onChange={(e) => setDigit(i, e.target.value)}
						onKeyDown={(e) => handleKeyDown(i, e)}
						onPaste={i === 0 ? handlePaste : undefined}
						disabled={submitting}
						autoFocus={i === 0}
						className="h-14 w-12 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] text-center text-xl font-semibold text-[var(--text-primary)] shadow-sm outline-none transition-[box-shadow,border-color] duration-150 focus:border-[var(--color-action-border)] focus:bg-[var(--input-bg)] focus:ring-[var(--color-action-ring)] disabled:opacity-50"
					/>
				))}
			</div>
			) : (
				<div className="space-y-2">
					<label htmlFor="two-factor-recovery-code" className="block text-sm font-medium text-[var(--text-secondary)]">
						{t("login.verify2faRecoveryLabel")}
					</label>
					<input
						id="two-factor-recovery-code"
						type="text"
						autoComplete="one-time-code"
						value={recoveryCode}
						onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
						placeholder="ABCD-EFGH-JKLM"
						disabled={submitting}
						className="h-12 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-center font-mono text-sm font-semibold tracking-wide text-[var(--text-primary)] outline-none transition-[box-shadow,border-color] focus:border-[var(--color-action-border)] focus:bg-[var(--input-bg)] focus:ring-[var(--color-action-ring)] disabled:opacity-50"
					/>
					<p className="text-xs text-[var(--text-muted)]">{t("login.verify2faRecoveryDescription")}</p>
				</div>
			)}

			{errorMsg ? (
				<StateBox tone="danger" role="alert" className="py-2.5 text-center">
					{errorMsg}
				</StateBox>
			) : null}

			<button
				type="submit"
				disabled={submitting || (mode === "totp" ? digits.some((d) => !d) : recoveryCode.trim().length === 0)}
				data-variant="primary" className="w-full py-2.5 text-sm font-semibold"
			>
				{submitting ? t("login.verify2faSubmitting") : t("login.verify2faSubmit")}
			</button>
		</form>
	);
}
