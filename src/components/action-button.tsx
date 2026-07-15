"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * Token-backed action button (`[data-action-button]` in globals.css).
 *
 * Variants:
 *   - primary (default): filled brand cyan — main CTAs
 *   - outline / ghost: quieter brand actions
 *   - success / danger: soft outline semantic CTAs
 *   - secondary: neutral surface button
 *
 * Prefer this (or SubmitButton) over hand-rolled color-action class strings.
 */
export type ActionButtonVariant =
	| "primary"
	| "outline"
	| "ghost"
	| "success"
	| "danger"
	| "secondary";

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
	children: ReactNode;
	variant?: ActionButtonVariant;
};

export function ActionButton({
	children,
	variant = "primary",
	type = "button",
	className,
	...rest
}: ActionButtonProps) {
	return (
		<button
			type={type}
			data-action-button
			data-variant={variant}
			className={cn(className)}
			{...rest}
		>
			{children}
		</button>
	);
}
