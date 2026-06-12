/**
 * Shared page-layout primitives used across dashboard pages.
 *
 * Previously each page defined its own Shell / Card / EmptyState / StatCard,
 * leading to ~80 lines of copy-pasted code.  This module centralises them
 * and fixes the semantic issue of nested <main> tags (root layout already
 * provides <main>, so PageShell uses a <div> instead).
 */

import type { ReactNode } from "react";

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
			? "bg-amber-500/20 text-amber-300"
			: "bg-cyan-500/20 text-cyan-300";
	const inactiveCls = "bg-slate-700/50 text-slate-400 hover:bg-slate-700 light:bg-slate-100";
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			aria-label={ariaLabel}
			className={`rounded-full px-3 py-1.5 transition ${active ? activeCls : inactiveCls}`}
		>
			{children}
		</button>
	);
}

/* ── PageShell ──────────────────────────────────────────────────────── */

export function PageShell({
	children,
	maxW = "max-w-6xl",
}: {
	children: ReactNode;
	/** Tailwind max-width class – defaults to "max-w-6xl" */
	maxW?: string;
}) {
	return (
		<div className="min-h-screen bg-[var(--page-bg)] text-[var(--text-primary)]">
			<div className={`mx-auto ${maxW} px-4 py-8 sm:px-6 sm:py-10 lg:px-10`}>{children}</div>
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
		<header className={className}>
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
					{eyebrow ? (
						<p data-page-eyebrow className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
							{eyebrow}
						</p>
					) : null}
					<h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>
					{description ? <p className="mt-1.5 text-sm text-[var(--text-muted)]">{description}</p> : null}
				</div>
				{children ? <div>{children}</div> : null}
			</div>
		</header>
	);
}

/* ── Card ───────────────────────────────────────────────────────────── */

export function Card({ children }: { children: ReactNode }) {
	return (
		<div data-card className="bg-white/[0.02]">{children}</div>
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
	cyan: { value: "text-cyan-300", detail: "text-cyan-400/70" },
	amber: { value: "text-amber-300", detail: "text-amber-400/70" },
	rose: { value: "text-rose-300", detail: "text-rose-400/70" },
	emerald: { value: "text-emerald-200", detail: "text-emerald-300/70" },
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
		<article data-card className="bg-white/[0.03] hover:bg-white/[0.05] transition-colors duration-150">
			<div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
				{label}
			</div>
			<div
				className={`mt-1.5 text-2xl font-semibold ${c ? c.value : "text-white"}`}
			>
				{value}
			</div>
			{detail && (
				<p
					className={`mt-0.5 text-[11px] ${c ? c.detail : "text-slate-500"}`}
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
			<div className="text-center text-slate-400">缺少权限</div>
		</PageShell>
	);
}
