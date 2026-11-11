"use client";

import { useState, useRef, type KeyboardEvent, type ClipboardEvent } from "react";
import { ActionButton } from "@/components/action-button";
import { Notice, SegmentedControl } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { ApiError } from "@/lib/http/api-client-error";
import { safeRelativeRedirectPath } from "@/lib/http/redirect-path";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

type Verify2faFormProps = {
	nextPath: string;
	error?: string;
};

export function Verify2faForm({ nextPath, error }: Verify2faFormProps) {
	const { t } = useI18n();
	const [digits, setDigits] = useState<string[]>(() => Array<string>(6).fill(""));
	const [mode, setMode] = useState<"totp" | "recovery">("totp");
	const [recoveryCode, setRecoveryCode] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [errorMsg, setErrorMsg] = useState(error);
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

	const EMPTY_CODE = Array<string>(6).fill("");

	/** Put `typed` digits into the boxes from `index` on, move the focus after them and send a complete code. */
	function fill(index: number, typed: string) {
		const next = [...digits];
		for (let offset = 0; offset < typed.length && index + offset < 6; offset++) next[index + offset] = typed[offset]!;
		setDigits(next);
		setErrorMsg(undefined);
		inputRefs.current[Math.min(index + typed.length, 5)]?.focus();
		if (next.every((digit) => digit !== "")) void submitCode(next.join(""));
	}

	function setDigit(index: number, value: string) {
		const typed = value.replace(/\D/g, "");
		if (!typed) {
			// Emptied, or something that is not a digit: the box is empty.
			if (digits[index]) setDigits(digits.map((digit, at) => (at === index ? "" : digit)));
			setErrorMsg(undefined);
			return;
		}
		// One more key in a filled box replaces its digit. Anything longer is a whole code put into one box (a
		// password manager, the system's one-time-code suggestion): it goes into the boxes from the first.
		if (typed.length <= 2) fill(index, typed.slice(-1));
		else fill(typed.length >= 6 ? 0 : index, typed.slice(0, 6));
	}

	function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Backspace" && !digits[index] && index > 0) {
			inputRefs.current[index - 1]?.focus();
		}
	}

	/** In any box: a whole code fills all of them, a shorter run of digits goes in from the box it was pasted into. */
	function handlePaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
		e.preventDefault();
		const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
		if (!pasted) return;
		fill(pasted.length === 6 ? 0 : index, pasted);
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
				// A full navigation, not router.push: the root layout decides on the server whether to draw the signed-in
				// shell, and this page was rendered without it. A client-side push kept that layout, so the landing page
				// had no sidebar, top bar or mobile navigation until the user reloaded.
				window.location.assign(safeRelativeRedirectPath(nextPath));
				return;
			}

			setErrorMsg(data.error || t("login.verify2faFailed"));
			startOver();
		} catch (error) {
			setErrorMsg(error instanceof ApiError ? error.message : t("login.verify2faNetworkError"));
			// A refused code is typed again from the first box. One that never reached the server stays: it may
			// still be good, and the button sends it again.
			if (error instanceof ApiError) startOver();
		} finally {
			setSubmitting(false);
		}
	}

	function startOver() {
		if (mode !== "totp") return;
		setDigits(EMPTY_CODE);
		inputRefs.current[0]?.focus();
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
			<div className="flex justify-center">
				<SegmentedControl
					ariaLabel={t("login.verify2faMethodLabel")}
					value={mode}
					onChange={(next) => { setMode(next); setErrorMsg(undefined); }}
					options={[
						{ value: "totp", label: t("login.verify2faUseAuthenticator") },
						{ value: "recovery", label: t("login.verify2faUseRecovery") },
					]}
				/>
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
						pattern="[0-9]*"
						// No length limit: a whole code may arrive in one box (see setDigit).
						autoComplete={i === 0 ? "one-time-code" : "off"}
						value={digit}
						onChange={(e) => setDigit(i, e.target.value)}
						onKeyDown={(e) => handleKeyDown(i, e)}
						onPaste={(e) => handlePaste(i, e)}
						// Read-only, not switched off, while the code is checked: a disabled box drops the focus, and
						// after a refused code nothing was focused to type the next one into.
						readOnly={submitting}
						aria-busy={submitting}
						autoFocus={i === 0}
						className={cn(UI_INPUT, "h-14 w-12 text-center text-xl font-semibold")}
					/>
				))}
			</div>
			) : (
				<div className="space-y-2">
					<label htmlFor="two-factor-recovery-code" className="ui-label block">
						{t("login.verify2faRecoveryLabel")}
					</label>
					<input
						id="two-factor-recovery-code"
						type="text"
						// Not a one-time code: a password manager would put the authenticator's digits here.
						autoComplete="off"
						value={recoveryCode}
						onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
						placeholder="ABCD-EFGH-JKLM"
						disabled={submitting}
						className={cn(UI_INPUT, "h-12 w-full text-center font-mono text-sm font-semibold")}
					/>
					<p className="text-xs text-[var(--text-muted)]">{t("login.verify2faRecoveryDescription")}</p>
				</div>
			)}

			{errorMsg ? (
				<Notice tone="danger">{errorMsg}</Notice>
			) : null}

			<ActionButton
				type="submit"
				block
				disabled={submitting || (mode === "totp" ? digits.some((d) => !d) : recoveryCode.trim().length === 0)}
				className="py-2.5 text-sm font-semibold"
			>
				{submitting ? t("login.verify2faSubmitting") : t("login.verify2faSubmit")}
			</ActionButton>
		</form>
	);
}
