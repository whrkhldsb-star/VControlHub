"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Primary action button using the brand `--color-action` (cyan) tokens.
 *
 * Styling lives in globals.css under `[data-action-button]`. This component
 * is the canonical primary CTA for the app — use it instead of hand-rolled
 * `bg-[var(--color-action)] hover:bg-[var(--color-action-bg)] …` strings so theme changes propagate
 * everywhere with one token edit.
 *
 * Variants:
 *   - primary (default): filled, high-contrast — for main CTAs ("Save", "Submit")
 *   - outline: transparent w/ token border — for secondary CTAs
 *   - ghost: tinted background — for tertiary inline actions
 */
export type ActionButtonVariant = "primary" | "outline" | "ghost";

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
			className={className}
			{...rest}
		>
			{children}
		</button>
	);
}
