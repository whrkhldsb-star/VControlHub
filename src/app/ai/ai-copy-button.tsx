"use client";

import { useEffect, useRef, useState } from "react";

import { Copy } from "@/components/icons";
import { copyText } from "@/lib/ui/clipboard";
import { cn } from "@/lib/ui/cn";

export type AiCopyLabels = { label: string; copiedLabel: string; failedLabel: string };

/**
 * The small "copy" under a message and on a code block. It says what came of the click — copied, or not —
 * and goes back to its label.
 */
export function AiCopyButton({
	text, label, copiedLabel, failedLabel, ariaLabel, className,
}: AiCopyLabels & {
	text: string;
	/** What it copies, where the label alone ("Copy") does not say. */
	ariaLabel?: string;
	className?: string;
}) {
	const [outcome, setOutcome] = useState<"copied" | "failed" | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => {
		if (timer.current) clearTimeout(timer.current);
	}, []);

	return (
		<button
			type="button"
			aria-label={outcome ? undefined : ariaLabel}
			data-copy-outcome={outcome ?? undefined}
			onClick={async () => {
				const copied = await copyText(text);
				setOutcome(copied ? "copied" : "failed");
				if (timer.current) clearTimeout(timer.current);
				timer.current = setTimeout(() => setOutcome(null), copied ? 2000 : 4000);
			}}
			className={cn(
				"flex items-center gap-1 text-xs transition",
				outcome === "failed" ? "text-[var(--danger)]" : outcome === "copied" ? "text-[var(--success)]" : "text-[var(--text-muted)] hover:text-[var(--accent)]",
				className,
			)}
		>
			<Copy size={12} aria-hidden="true" />
			<span aria-live="polite">{outcome === "copied" ? copiedLabel : outcome === "failed" ? failedLabel : label}</span>
		</button>
	);
}
