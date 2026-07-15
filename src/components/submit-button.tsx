"use client";

import { useFormStatus } from "react-dom";

import { cn } from "@/lib/ui/cn";

/**
 * Form submit button that wires `useFormStatus` pending state.
 *
 * Default (no `className`): uses canonical `[data-action-button]` primary styles.
 * With `className`: treats the caller as providing a full visual override (success /
 * danger / outline CTAs) and does not attach action-button tokens — so existing
 * multi-tone submit UIs keep working. Prefer layout-only classes via a future
 * `variant` API when migrating those call sites.
 */
export function SubmitButton({
	pendingLabel,
	children,
	className,
	name,
	value,
	disabled,
}: {
	pendingLabel: string;
	children: React.ReactNode;
	className?: string;
	name?: string;
	value?: string;
	disabled?: boolean;
}) {
	const { pending } = useFormStatus();
	const usesTokenStyles = !className;

	return (
		<button
			type="submit"
			name={name}
			value={value}
			disabled={pending || disabled}
			aria-busy={pending}
			data-action-button={usesTokenStyles ? "" : undefined}
			data-variant={usesTokenStyles ? "primary" : undefined}
			className={cn(className)}
		>
			{pending ? pendingLabel : children}
		</button>
	);
}
