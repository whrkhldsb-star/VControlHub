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
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--accent)_12%,transparent),transparent_68%)] light:opacity-90"
			/>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_80%_0%,color-mix(in_srgb,var(--color-action)_8%,transparent),transparent_60%)] opacity-70"
			/>
			<div className={`relative mx-auto ${maxW} px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-16 sm:px-6 sm:pb-16 sm:pt-8 lg:px-10 lg:py-10`}>
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
		<header className={`${className} relative`} data-page-header>
			<div className="flex flex-col gap-4 sm:gap-5 lg:flex-row lg:items-end lg:justify-between">
				<div className="min-w-0 max-w-3xl">
					{eyebrow ? (
						<p
							data-page-eyebrow
							className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]"
						>
							<span className="h-1 w-1 rounded-full bg-[var(--accent)]" aria-hidden="true" />
							{eyebrow}
						</p>
					) : null}
					<h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-[var(--text-primary)] sm:text-[2rem]">
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
