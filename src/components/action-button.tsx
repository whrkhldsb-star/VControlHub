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
 *   - success-solid / danger-solid: solid fills for start/delete confirms
 *   - secondary: neutral surface button
 *
 * Prefer this (or SubmitButton) over hand-rolled color-action class strings.
 * Keep `className` for layout only (`w-full`, `min-h-11`, `!px-3 !text-xs`).
 */
export type ActionButtonVariant =
	| "primary"
	| "outline"
	| "ghost"
	| "success"
	| "danger"
	| "success-solid"
	| "danger-solid"
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
