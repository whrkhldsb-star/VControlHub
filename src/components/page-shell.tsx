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
	const inactiveCls =
		"bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)] border-[var(--border)]";
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			aria-label={ariaLabel}
			className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${active ? activeCls : inactiveCls}`}
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
		<div className="relative min-h-screen overflow-x-clip text-[var(--text-primary)]">
			{/* Decorative wash only — never intercept layout/overflow for titles */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--accent)_12%,transparent),transparent_65%)]"
			/>
			{/*
			  Mobile needs extra top padding for the fixed hamburger (left-4 top-4).
			  Keep overflow visible on the content column so large titles are not clipped.
			*/}
			<div
				className={`relative mx-auto min-w-0 ${maxW} px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-20 sm:px-6 sm:pb-16 sm:pt-8 lg:px-10 lg:py-10`}
			>
				{children}
			</div>
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

export function PageHeader({ eyebrow, title, description, children, className = "mb-6 sm:mb-8" }: PageHeaderProps) {
	return (
		<header className={`${className} relative overflow-visible`} data-page-header>
			<div className="flex flex-col gap-4 sm:gap-5 lg:flex-row lg:items-end lg:justify-between">
				<div className="min-w-0 max-w-3xl overflow-visible">
					{eyebrow ? (
						<p
							data-page-eyebrow
							className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]"
						>
							<span className="h-1 w-1 rounded-full bg-[var(--accent)]" aria-hidden="true" />
							{eyebrow}
						</p>
					) : null}
					{/* leading-snug avoids Chinese glyph clipping from leading-tight + negative tracking */}
					<h1 className="break-words text-[1.75rem] font-semibold leading-snug tracking-[-0.02em] text-[var(--text-primary)] sm:text-[2rem]">
						{title}
					</h1>
					{description ? (
						<p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{description}</p>
					) : null}
				</div>
				{children ? (
					<div className="flex shrink-0 flex-wrap items-center gap-2" data-page-actions>
						{children}
					</div>
				) : null}
			</div>
			<div className="mt-5 h-px w-full bg-[linear-gradient(90deg,var(--border),transparent_90%)]" aria-hidden="true" />
		</header>
	);
}

/* ── Toolbar ────────────────────────────────────────────────────────── */

/** Sticky action/filter row under page headers. */
export function Toolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
	return (
		<div
			data-toolbar
			className={`mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] p-2.5 shadow-[var(--shadow-sm)] backdrop-blur-md ${className}`}
		>
			{children}
		</div>
	);
}

/* ── Card ───────────────────────────────────────────────────────────── */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div data-card className={className}>
			{children}
		</div>
	);
}

/* ── EmptyState ─────────────────────────────────────────────────────── */

export function EmptyState({
	text,
	children,
	variant = "simple",
	icon,
	action,
}: {
	/** Convenience string text. Ignored when `children` is provided. */
	text?: string;
	/** Rich content (e.g. JSX expression). Takes precedence over `text`. */
	children?: ReactNode;
	/** "simple" = plain text; "boxed" = dashed-border card */
	variant?: "simple" | "boxed";
	icon?: ReactNode;
	action?: ReactNode;
}) {
	const body = children ?? text;
	const content = (
		<>
			{icon ? (
				<div
					className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-2xl text-[var(--text-muted)]"
					aria-hidden="true"
				>
					{icon}
				</div>
			) : null}
			<div className="max-w-md text-sm leading-6 text-[var(--text-muted)]">{body}</div>
			{action ? <div className="mt-4">{action}</div> : null}
		</>
	);
	if (variant === "boxed") {
		return (
			<div
				data-empty-state="boxed"
				className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] px-6 py-14 text-center"
			>
				{content}
			</div>
		);
	}
	return (
		<div data-empty-state className="flex flex-col items-center justify-center py-10 text-center">
			{content}
		</div>
	);
}

/* ── StatCard ───────────────────────────────────────────────────────── */

const ACCENT_COLORS = {
	cyan: { value: "text-[var(--accent)]", bar: "bg-[var(--accent)]" },
	amber: { value: "text-[var(--warning)]", bar: "bg-[var(--warning)]" },
	rose: { value: "text-[var(--danger)]", bar: "bg-[var(--danger)]" },
	emerald: { value: "text-[var(--success)]", bar: "bg-[var(--success)]" },
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
		<article
			data-card
			data-stat-card
			className="relative overflow-hidden bg-[var(--surface)] transition-colors duration-150 hover:bg-[var(--surface-elevated)]"
		>
			<div className={`absolute inset-x-0 top-0 h-0.5 ${c ? c.bar : "bg-[var(--border)]"}`} aria-hidden="true" />
			<div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</div>
			<div className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${c ? c.value : "text-[var(--text-primary)]"}`}>
				{value}
			</div>
			{detail ? <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">{detail}</p> : null}
		</article>
	);
}

/* ── Section ────────────────────────────────────────────────────────── */

export function Section({
	title,
	description,
	actions,
	children,
	className = "",
}: {
	title?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section data-section className={`space-y-3 ${className}`}>
			{(title || actions) && (
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div className="min-w-0">
						{title ? <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2> : null}
						{description ? <p className="mt-0.5 text-xs text-[var(--text-muted)]">{description}</p> : null}
					</div>
					{actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
				</div>
			)}
			{children}
		</section>
	);
}

/* ── StatGrid ───────────────────────────────────────────────────────── */

/** Responsive metric row under page headers. */
export function StatGrid({
	children,
	className = "",
	cols = 4,
}: {
	children: ReactNode;
	className?: string;
	/** Preferred desktop column count (2–5). */
	cols?: 2 | 3 | 4 | 5;
}) {
	const colCls =
		cols === 2
			? "sm:grid-cols-2"
			: cols === 3
				? "sm:grid-cols-2 lg:grid-cols-3"
				: cols === 5
					? "sm:grid-cols-2 lg:grid-cols-5"
					: "sm:grid-cols-2 lg:grid-cols-4";
	return (
		<section data-stat-grid className={`mb-5 grid gap-3 ${colCls} ${className}`}>
			{children}
		</section>
	);
}

/* ── ListPanel ──────────────────────────────────────────────────────── */

/**
 * Unified list/table chrome: header + divided body.
 * Use for shares, users, audit, tokens, tickets, etc.
 */
export function ListPanel({
	title,
	count,
	actions,
	children,
	className = "",
	bodyClassName = "",
	empty,
}: {
	title?: ReactNode;
	count?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
	className?: string;
	bodyClassName?: string;
	/** When provided and truthy, replaces body content (typical empty state). */
	empty?: ReactNode;
}) {
	return (
		<div data-list-panel data-card className={`overflow-hidden !p-0 ${className}`}>
			{(title != null || count != null || actions != null) && (
				<div
					data-list-panel-header
					className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:px-5"
				>
					<div className="flex min-w-0 items-center gap-2.5">
						{title != null ? (
							<div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
						) : null}
						{count != null ? (
							<span className="inline-flex min-w-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
								{count}
							</span>
						) : null}
					</div>
					{actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
				</div>
			)}
			<div
				data-list-panel-body
				className={`divide-y divide-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-subtle)_55%,var(--surface))] ${bodyClassName}`}
			>
				{empty ?? children}
			</div>
		</div>
	);
}

/** One row inside ListPanel — consistent padding + hover. */
export function ListRow({
	children,
	className = "",
	onClick,
}: {
	children: ReactNode;
	className?: string;
	onClick?: () => void;
}) {
	const interactive = typeof onClick === "function";
	return (
		<div
			data-list-row
			role={interactive ? "button" : undefined}
			tabIndex={interactive ? 0 : undefined}
			onClick={onClick}
			onKeyDown={
				interactive
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onClick?.();
							}
						}
					: undefined
			}
			className={`px-4 py-3.5 transition hover:bg-[var(--surface-hover)] sm:px-5 ${
				interactive ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]" : ""
			} ${className}`}
		>
			{children}
		</div>
	);
}

/** Soft surface panel for create forms / secondary blocks. */
export function SurfacePanel({
	children,
	className = "",
	title,
	description,
	actions,
}: {
	children: ReactNode;
	className?: string;
	title?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<div
			data-surface-panel
			data-card
			className={`space-y-4 p-4 sm:p-5 ${className}`}
		>
			{(title || actions) && (
				<div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
					<div className="min-w-0">
						{title ? <h2 className="text-sm font-semibold text-[var(--text-primary)] sm:text-base">{title}</h2> : null}
						{description ? <p className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">{description}</p> : null}
					</div>
					{actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
				</div>
			)}
			{children}
		</div>
	);
}

/* ── PermissionDenied ───────────────────────────────────────────────── */

export function PermissionDenied() {
	return (
		<PageShell>
			<div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
				<div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-2xl" aria-hidden="true">
					🔒
				</div>
				<p className="text-sm text-[var(--text-muted)]">
					<LocalizedText textKey="common.noPermission" fallback="Missing permission" />
				</p>
			</div>
		</PageShell>
	);
}
