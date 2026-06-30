"use client";

import { useState, useRef, type KeyboardEvent, type ClipboardEvent } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";

type Verify2faFormProps = {
	nextPath: string;
	error?: string;
};

export function Verify2faForm({ nextPath, error }: Verify2faFormProps) {
	const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
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
				router.push(nextPath);
				router.refresh();
				return;
			}

			setErrorMsg(data.error || "验证失败");
			setDigits(Array(6).fill(""));
			inputRefs.current[0]?.focus();
		} catch {
			setErrorMsg("网络错误，请重试");
		} finally {
			setSubmitting(false);
		}
	}

	function handleResubmit(e: React.FormEvent) {
		e.preventDefault();
		const code = digits.join("");
		if (code.length === 6) {
			submitCode(code);
		}
	}

	return (
		<form onSubmit={handleResubmit} className="space-y-4">
			<div className="flex justify-center gap-2">
				{digits.map((digit, i) => (
					<input
						key={i}
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
						aria-label={`验证码第 ${i + 1} 位`}
						className="h-14 w-12 rounded-xl bg-white/[0.04] text-center text-xl font-semibold text-[var(--text-primary)] shadow-[0_0_0_1px_rgba(255,255,255,0.07)] outline-none transition-[box-shadow,background-color] duration-150 placeholder:text-white/20 focus:bg-white/[0.06] focus:shadow-[0_0_0_1px_rgba(34,211,238,0.3),0_0_0_4px_rgba(34,211,238,0.08)] disabled:opacity-50"
					/>
				))}
			</div>

			{errorMsg ? (
				<div className="rounded-xl bg-rose-500/[0.08] px-4 py-2.5 text-sm text-rose-200 shadow-[0_0_0_1px_rgba(251,113,133,0.15)]">
					{errorMsg}
				</div>
			) : null}

			<button
				type="submit"
				disabled={submitting || digits.some((d) => !d)}
				className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-3 text-sm font-medium text-[var(--text-primary)] shadow-[0_0_0_1px_rgba(34,211,238,0.2),0_8px_20px_rgba(34,211,238,0.15)] transition-[filter,box-shadow] duration-150 hover:brightness-110 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.3),0_12px_28px_rgba(34,211,238,0.25)] focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50 disabled:hover:brightness-100"
			>
				{submitting ? "验证中..." : "验证"}
			</button>
		</form>
	);
}
