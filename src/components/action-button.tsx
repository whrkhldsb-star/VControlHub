"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * Buttons. The look of every variant and size lives in one place —
 * `[data-action-button]` rules in `src/app/globals.css` — so changing a
 * button's appearance never means editing call sites.
 *
 * Variants:
 *   - primary (default): solid brand fill — the main command of a view
 *   - secondary: neutral surface — everything else
 *   - outline: brand-tinted, borderless — a prominent secondary command
 *   - ghost: text only — toolbars and low-emphasis actions
 *   - success / danger / warning: neutral at rest, semantic text and hover
 *   - success-solid / danger-solid: solid fills for confirmations
 *
 * Sizes: xs (26px) · sm (30px) · md (36px, default) · lg (40px); touch
 * screens get taller controls via --control-height. `square` makes an
 * icon-only button of the same height.
 * `className` is for layout only (`w-full`, `ml-auto`, `flex-1`).
 */
export type ActionButtonVariant =
	| "primary"
	| "outline"
	| "ghost"
	| "success"
	| "danger"
	| "warning"
	| "success-solid"
	| "danger-solid"
	| "secondary";

export type ButtonSize = "xs" | "sm" | "md" | "lg";

type ButtonLookProps = {
	variant?: ActionButtonVariant;
	size?: ButtonSize;
	/** Leading icon (an SVG); replaced by a spinner while `loading`. */
	icon?: ReactNode;
	/** Trailing icon, e.g. a chevron or external-link glyph. */
	iconRight?: ReactNode;
	/** Stretch to the container width. */
	block?: boolean;
	/** Icon-only square button (pass an aria-label). */
	square?: boolean;
};

function lookAttributes({ variant = "primary", size = "md", block, square }: ButtonLookProps) {
	return {
		"data-action-button": "",
		"data-variant": variant,
		"data-size": size === "md" ? undefined : size,
		"data-block": block ? "" : undefined,
		"data-square": square ? "" : undefined,
	};
}

export function ButtonSpinner() {
	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="animate-spin">
			<circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
			<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
		</svg>
	);
}

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> &
	ButtonLookProps & {
		children?: ReactNode;
		/** Shows a spinner, disables the button and sets aria-busy. */
		loading?: boolean;
		/** React 19 style ref prop (dialog focus management etc.). */
		ref?: Ref<HTMLButtonElement>;
	};

export function ActionButton({
	children,
	variant = "primary",
	size = "md",
	icon,
	iconRight,
	block,
	square,
	loading = false,
	type = "button",
	className,
	disabled,
	...rest
}: ActionButtonProps) {
	return (
		<button
			type={type}
			{...lookAttributes({ variant, size, block, square })}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			className={cn(className)}
			{...rest}
		>
			{loading ? <ButtonSpinner /> : icon}
			{children}
			{iconRight}
		</button>
	);
}

/** Preferred name for new code. */
export const Button = ActionButton;

type ButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href"> &
	ButtonLookProps & {
		href: string;
		children?: ReactNode;
		/** Open in a new tab with rel="noopener noreferrer". */
		external?: boolean;
		/** Forwarded to next/link. */
		prefetch?: boolean;
		ref?: Ref<HTMLAnchorElement>;
	};

/** A link that looks like a button (navigation, not an action). */
export function ButtonLink({
	href,
	children,
	variant = "secondary",
	size = "md",
	icon,
	iconRight,
	block,
	square,
	external = false,
	prefetch,
	className,
	...rest
}: ButtonLinkProps) {
	const content = (
		<>
			{icon}
			{children}
			{iconRight}
		</>
	);
	const attributes = { ...lookAttributes({ variant, size, block, square }), className: cn(className) };
	if (external) {
		return (
			<a href={href} target="_blank" rel="noopener noreferrer" {...attributes} {...rest}>
				{content}
			</a>
		);
	}
	return (
		<Link href={href} prefetch={prefetch} {...attributes} {...rest}>
			{content}
		</Link>
	);
}
