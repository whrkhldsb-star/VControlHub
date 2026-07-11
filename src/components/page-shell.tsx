/**
 * Shared page-layout primitives used across dashboard pages.
 *
 * Previously each page defined its own Shell / Card / EmptyState / StatCard,
 * leading to ~80 lines of copy-pasted code.  This module centralises them
 * and fixes the semantic issue of nested <main> tags (root layout already
 * provides <main>, so PageShell uses a <div> instead).
 */

import type { ReactNode } from "react";
import { LocalizedText } from "./localized-text";

/* ── ToggleChip ────────────────────────────────────────────────────── */
/**
 * Two-state pill toggle used in toolbar rows (e.g. "仅自己/全部用户",
 * "批量模式 开/关").  Active = accent tint, inactive = muted surface.
 * Color tone: accent (cyan) or warn (amber).
 */
type ToggleTone = "accent" | "warn";

export function ToggleChip({
	active,
	onClick,
	children,
	tone = "accent",
	ariaLabel,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
	tone?: ToggleTone;
	ariaLabel?: string;
}) {
	const activeCls =
		tone === "warn"
			? "bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning-border)]"
			: "bg-[var(--accent-bg)] text-[var(--accent)] border-[var(--accent-border)]";
	const inactiveCls = "bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-secondary)] border-[var(--border)]";
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			aria-label={ariaLabel}
			className={`rounded-full border px-3 py-1.5 transition ${active ? activeCls : inactiveCls}`}
		>
			{children}
		</button>
	);
}

/* ── PageShell ──────────────────────────────────────────────────────── */

export function PageShell({
	children,
	maxW = "max-w-7xl",
}: {
	children: ReactNode;
	/** Tailwind max-width class – defaults to "max-w-7xl" */
	maxW?: string;
}) {
	return (
		<div className="relative min-h-screen overflow-hidden [background:var(--page-bg)] text-[var(--text-primary)]">
			<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(56,139,253,0.10),transparent_68%)]" />
			<div className={`relative mx-auto ${maxW} px-4 pb-32 pt-20 sm:px-6 sm:py-10 lg:px-12 lg:py-12`}>{children}</div>
		</div>
	);
}

/* ── PageHeader ─────────────────────────────────────────────────────── */

type PageHeaderProps = {
	eyebrow: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	className?: string;
};

export function PageHeader({ eyebrow, title, description, children, className = "mb-8" }: PageHeaderProps) {
	return (
		<header className={`${className} relative border-b border-[var(--border-subtle)] pb-6`}>
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div className="max-w-3xl">
					{eyebrow ? (
						<p data-page-eyebrow className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-[var(--accent)]">
							{eyebrow}
						</p>
					) : null}
					<h1 className="text-3xl font-semibold tracking-[-0.035em] text-[var(--text-primary)] sm:text-[2rem]">{title}</h1>
					{description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{description}</p> : null}
				</div>
				{children ? <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div> : null}
			</div>
		</header>
	);
}

/* ── Card ───────────────────────────────────────────────────────────── */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div data-card className={className}>{children}</div>
	);
}

/* ── EmptyState ─────────────────────────────────────────────────────── */

export function EmptyState({
	text,
	children,
	variant = "simple",
	icon,
}: {
	/** Convenience string text. Ignored when `children` is provided. */
	text?: string;
	/** Rich content (e.g. JSX expression). Takes precedence over `text`. */
	children?: ReactNode;
	/** "simple" = plain text; "boxed" = dashed-border card */
	variant?: "simple" | "boxed";
	icon?: ReactNode;
}) {
	const body = children ?? text;
	const content = (
		<>
			{icon ? <div className="mb-3 text-4xl" aria-hidden="true">{icon}</div> : null}
			<div>{body}</div>
		</>
	);
	if (variant === "boxed") {
		return <div data-empty-state="boxed">{content}</div>;
	}
	return <div data-empty-state>{content}</div>;
}

/* ── StatCard ───────────────────────────────────────────────────────── */

const ACCENT_COLORS = {
	cyan: { value: "text-[var(--accent)]", detail: "text-[var(--text-muted)]" },
	amber: { value: "text-[var(--warning)]", detail: "text-[var(--text-muted)]" },
	rose: { value: "text-[var(--danger)]", detail: "text-[var(--text-muted)]" },
	emerald: { value: "text-[var(--success)]", detail: "text-[var(--text-muted)]" },
} as const;

type AccentColor = keyof typeof ACCENT_COLORS;

export function StatCard({
	label,
	value,
	accent,
	accentColor,
	detail,
}: {
	label: string;
	value: string | number;
	accent?: boolean;
	accentColor?: AccentColor;
	detail?: string;
}) {
	const c = accent && accentColor ? ACCENT_COLORS[accentColor] : null;
	return (
		<article data-card className="bg-[var(--surface)] hover:bg-[var(--surface-elevated)] transition-colors duration-150">
			<div className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
				{label}
			</div>
			<div
				className={`mt-1.5 text-2xl font-semibold tabular-nums ${c ? c.value : "text-[var(--text-primary)]"}`}
			>
				{value}
			</div>
			{detail && (
				<p
					className={`mt-0.5 text-[11px] ${c ? c.detail : "text-[var(--text-muted)]"}`}
				>
					{detail}
				</p>
			)}
		</article>
	);
}

/* ── PermissionDenied ───────────────────────────────────────────────── */

export function PermissionDenied() {
	return (
		<PageShell>
			<div className="text-center text-[var(--text-muted)]"><LocalizedText textKey="common.noPermission" fallback="Missing permission" /></div>
		</PageShell>
	);
}
