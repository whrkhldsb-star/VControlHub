"use client";

import { useFormStatus } from "react-dom";

import { cn } from "@/lib/ui/cn";
import type { ActionButtonVariant } from "@/components/action-button";

/**
 * Form submit button with `useFormStatus` pending state.
 *
 * Always attaches `[data-action-button]` so theme tokens apply. Use `variant`
 * for semantic looks; keep `className` for layout only (`w-full`, `flex-1`).
 *
 * Legacy: if `className` is a long hand-rolled visual override and no
 * `variant` is set, we still honor full class override by skipping tokens —
 * migrate those call sites to `variant` when touching the file.
 */
export function SubmitButton({
	pendingLabel,
	children,
	className,
	name,
	value,
	disabled,
	variant = "primary",
	toneOverride,
}: {
	pendingLabel: string;
	children: React.ReactNode;
	className?: string;
	name?: string;
	value?: string;
	disabled?: boolean;
	variant?: ActionButtonVariant;
	/**
	 * When true, treat `className` as a full visual override (no data-action-button).
	 * Prefer migrating to `variant` instead.
	 */
	toneOverride?: boolean;
}) {
	const { pending } = useFormStatus();
	const usesTokenStyles = !toneOverride;

	return (
		<button
			type="submit"
			name={name}
			value={value}
			disabled={pending || disabled}
			aria-busy={pending}
			data-action-button={usesTokenStyles ? "" : undefined}
			data-variant={usesTokenStyles ? variant : undefined}
			className={cn(className)}
		>
			{pending ? pendingLabel : children}
		</button>
	);
}
