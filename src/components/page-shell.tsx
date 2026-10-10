/**
 * Shared page-layout primitives used across dashboard pages.
 *
 * Previously each page defined its own Shell / Card / EmptyState / StatCard,
 * leading to ~80 lines of copy-pasted code.  This module centralises them
 * and fixes the semantic issue of nested <main> tags (root layout already
 * provides <main>, so PageShell uses a <div> instead).
 */

import type { HTMLAttributes, ReactNode } from "react";
import { LocalizedText } from "./localized-text";
import { File as FileIcon } from "./icons";
import { Chip } from "./ui-primitives";
import { cn } from "@/lib/ui/cn";

/* ── ToggleChip ────────────────────────────────────────────────────── */
/**
 * Two-state toggle in a toolbar row ("仅自己/全部用户", "批量模式"): a
 * control-height <Chip>. Active = accent tint (or warning), inactive = neutral.
 */
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
	tone?: "accent" | "warn";
	ariaLabel?: string;
}) {
	return (
		<Chip size="md" selected={active} tone={tone === "warn" ? "warning" : "accent"} onClick={onClick} aria-label={ariaLabel}>
			{children}
		</Chip>
	);
}

/* ── PageShell ──────────────────────────────────────────────────────── */

/**
 * Page frame: one width and one set of gutters for every page, so titles line
 * up under the breadcrumb everywhere. `width="narrow"` caps the content for
 * reading-width pages (forms, public status) but keeps it left-aligned in the
 * same frame instead of centring it.
 */
export function PageShell({
	children,
	width = "wide",
	navigation = true,
}: {
	children: ReactNode;
	width?: "wide" | "narrow";
	/** Public pages have no application chrome to sit inside. */
	navigation?: boolean;
}) {
	return (
		<div data-page-shell data-shell={navigation ? "app" : "public"} className="min-w-0 text-[var(--text-primary)]">
			<div
				className={`mx-auto min-w-0 max-w-[var(--content-max)] px-4 sm:px-6 lg:px-8 ${navigation ? "pb-10 pt-5 lg:pb-14 lg:pt-7" : "py-10 sm:py-14"}`}
			>
				{width === "narrow" ? <div className={cn("min-w-0 max-w-5xl", !navigation && "mx-auto")}>{children}</div> : children}
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

export function PageHeader({ eyebrow, title, description, children, className = "mb-6" }: PageHeaderProps) {
	return (
		<header className={`${className} relative overflow-visible`} data-page-header>
			<div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div className="min-w-0 max-w-3xl overflow-visible">
					{eyebrow ? (
						<p
							data-page-eyebrow
							className="mb-2 text-xs font-medium text-[var(--accent)]"
						>
							{eyebrow}
						</p>
					) : null}
					<h1 className="ui-title-page break-words">
						{title}
					</h1>
					{description ? (
						<p className="mt-1.5 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">{description}</p>
					) : null}
				</div>
				{children ? (
					<div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end lg:pt-0.5" data-page-actions>
						{children}
					</div>
				) : null}
			</div>
		</header>
	);
}

/* ── Toolbar ────────────────────────────────────────────────────────── */

/**
 * Layout blocks carry a default bottom margin unless the caller sets its own
 * (`cn` does not resolve conflicting utilities, so both would otherwise ship).
 */
function withDefaultMargin(defaultMargin: string, className = "") {
	return /(^|\s)!?(m|my|mb)-/.test(className) ? className : `${defaultMargin} ${className}`.trim();
}

/** Action/filter row under page headers. */
export function Toolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
	return (
		<div
			data-toolbar
			className={`flex min-w-0 flex-wrap items-center gap-2 ${withDefaultMargin("mb-4", className)}`}
		>
			{children}
		</div>
	);
}

/* ── Card ───────────────────────────────────────────────────────────── */

const CARD_PADDING = { none: "p-0", sm: "p-3", md: undefined, lg: "p-5 sm:p-6" } as const;
/** Footers bleed to the card edge, so they cancel the card padding. */
const CARD_FOOTER_BLEED = {
	none: "px-4",
	sm: "-mx-3 -mb-3 px-3",
	md: "-mx-4 -mb-4 px-4",
	lg: "-mx-5 -mb-5 px-5 sm:-mx-6 sm:-mb-6 sm:px-6",
} as const;

/**
 * The standard content card. Chrome comes from `[data-card]` in globals.css;
 * `title` / `description` / `actions` render the usual header row and
 * `footer` a hairline-separated action strip.
 */
export function Card({
	children,
	className,
	title,
	description,
	actions,
	footer,
	padding = "md",
	as: Element = "div",
	...rest
}: {
	children?: ReactNode;
	className?: string;
	title?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	footer?: ReactNode;
	padding?: keyof typeof CARD_PADDING;
	as?: "div" | "section" | "article" | "li";
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
	const hasHeader = title != null || description != null || actions != null;
	return (
		<Element data-card className={[CARD_PADDING[padding], className].filter(Boolean).join(" ") || undefined} {...rest}>
			{hasHeader ? (
				<div data-card-header className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
					<div className="min-w-0 flex-1">
						{title != null ? <h2 className="ui-title-section">{title}</h2> : null}
						{description != null ? <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-muted)]">{description}</p> : null}
					</div>
					{actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
				</div>
			) : null}
			{children}
			{footer ? (
				<div data-card-footer className={`${CARD_FOOTER_BLEED[padding]} mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] py-3`}>
					{footer}
				</div>
			) : null}
		</Element>
	);
}

/* ── EmptyState ─────────────────────────────────────────────────────── */

/**
 * Shared empty-state visual language: an icon tile (default file glyph)
 * above the copy, optional action. "simple" centers inside the existing
 * panel chrome (ListPanel body etc.); "boxed" adds the dashed card for
 * page-level blocks that have no panel of their own.
 */
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
	/** "simple" = plain centered block; "boxed" = dashed-border card */
	variant?: "simple" | "boxed";
	icon?: ReactNode;
	action?: ReactNode;
}) {
	const body = children ?? text;
	const content = (
		<>
			<div
				className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] shadow-[var(--shadow-xs)] [&>svg]:h-5 [&>svg]:w-5"
				aria-hidden="true"
			>
				{icon ?? <FileIcon size={20} />}
			</div>
			<div className="max-w-md text-sm leading-6 text-[var(--text-muted)]">{body}</div>
			{action ? <div className="mt-4">{action}</div> : null}
		</>
	);
	if (variant === "boxed") {
		return (
			<div
				data-empty-state="boxed"
				className="flex flex-col items-center justify-center border border-dashed border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-12 text-center"
			>
				{content}
			</div>
		);
	}
	return (
		<div data-empty-state className="flex flex-col items-center justify-center px-4 py-10 text-center">
			{content}
		</div>
	);
}

/* ── StatCard ───────────────────────────────────────────────────────── */

const ACCENT_COLORS = {
	cyan: { value: "text-[var(--accent)]", dot: "bg-[var(--accent)]" },
	amber: { value: "text-[var(--warning)]", dot: "bg-[var(--warning)]" },
	rose: { value: "text-[var(--danger)]", dot: "bg-[var(--danger)]" },
	emerald: { value: "text-[var(--success)]", dot: "bg-[var(--success)]" },
} as const;

type AccentColor = keyof typeof ACCENT_COLORS;

export function StatCard({
	label,
	value,
	accent,
	accentColor,
	detail,
	className,
}: {
	label: string;
	value: string | number;
	accent?: boolean;
	accentColor?: AccentColor;
	detail?: string;
	className?: string;
}) {
	const c = accent && accentColor ? ACCENT_COLORS[accentColor] : null;
	return (
		<article
			data-card
			data-stat-card
			className={`relative flex flex-col justify-between overflow-hidden bg-[var(--surface)] ${className ?? ""}`}
		>
			<div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text-muted)]">
				{c ? <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} /> : null}
				<span className="min-w-0 truncate">{label}</span>
			</div>
			<div className={`mt-2 break-words text-2xl font-semibold leading-tight tracking-tight tabular-nums ${c ? c.value : "text-[var(--text-primary)]"}`}>
				{value}
			</div>
			{detail ? <p className="mt-1 text-xs leading-4 text-[var(--text-muted)]">{detail}</p> : null}
		</article>
	);
}

/* ── MetricPanel ────────────────────────────────────────────────────── */

export type Metric = {
	label: string;
	value: ReactNode;
	/** Colour of the value and its dot; omit for neutral figures. */
	tone?: AccentColor;
	detail?: ReactNode;
	href?: string;
};

/**
 * A titled card of related figures separated by hairlines — one surface for
 * a group of numbers instead of a card per number.
 */
export function MetricPanel({
	title,
	eyebrow,
	description,
	actions,
	metrics,
	columns = 4,
	className = "",
	...rest
}: {
	title?: ReactNode;
	eyebrow?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	metrics: Metric[];
	/** Desktop column count. */
	columns?: 2 | 3 | 4 | 6;
	className?: string;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
	const colCls = columns === 2 ? "sm:grid-cols-2" : columns === 3 ? "sm:grid-cols-3" : columns === 6 ? "sm:grid-cols-3 xl:grid-cols-6" : "sm:grid-cols-2 lg:grid-cols-4";
	return (
		<section data-card data-metric-panel className={`!p-0 ${className}`} {...rest}>
			{title != null || actions != null ? (
				<div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-3.5 sm:px-5">
					<div className="min-w-0">
						{eyebrow ? <p className="text-xs font-medium text-[var(--accent)]">{eyebrow}</p> : null}
						{title != null ? <h2 className="ui-title-section">{title}</h2> : null}
						{description ? <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</p> : null}
					</div>
					{actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
				</div>
			) : null}
			<div className={`grid grid-cols-2 gap-px overflow-hidden rounded-b-[var(--radius-card)] border-t border-[var(--border-subtle)] bg-[var(--border-subtle)] ${title == null && actions == null ? "rounded-t-[var(--radius-card)] border-t-0" : ""} ${colCls}`}>
				{metrics.map((metric) => {
					const c = metric.tone ? ACCENT_COLORS[metric.tone] : null;
					const body = (
						<>
							<div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text-muted)]">
								{c ? <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} /> : null}
								<span className="min-w-0 truncate">{metric.label}</span>
							</div>
							<div className={`mt-1.5 break-words text-[22px] font-semibold leading-tight tracking-tight tabular-nums ${c ? c.value : "text-[var(--text-primary)]"}`}>
								{metric.value}
							</div>
							{metric.detail ? <div className="mt-0.5 text-xs text-[var(--text-muted)]">{metric.detail}</div> : null}
						</>
					);
					return metric.href ? (
						<a key={metric.label} href={metric.href} className="block bg-[var(--surface)] px-4 py-3.5 transition hover:bg-[var(--surface-hover)] sm:px-5">{body}</a>
					) : (
						<div key={metric.label} className="bg-[var(--surface)] px-4 py-3.5 sm:px-5">{body}</div>
					);
				})}
			</div>
		</section>
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
						{title ? <h2 className="ui-title-section">{title}</h2> : null}
						{description ? <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</p> : null}
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
		<section data-stat-grid className={`grid grid-cols-2 gap-3 max-[340px]:grid-cols-1 ${colCls} ${withDefaultMargin("mb-6", className)}`}>
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
	description,
	count,
	actions,
	children,
	className = "",
	bodyClassName = "",
	empty,
}: {
	title?: ReactNode;
	/** Optional helper copy under the title (list scope / filter guidance). */
	description?: ReactNode;
	count?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
	className?: string;
	bodyClassName?: string;
	/** When provided and truthy, replaces body content (typical empty state). */
	empty?: ReactNode;
}) {
	return (
		<div data-list-panel className={`min-w-0 ${className}`}>
			{(title != null || description != null || count != null || actions != null) && (
				<div
					data-list-panel-header
					className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5"
				>
					<div className="min-w-0">
						<div className="flex min-w-0 items-center gap-2">
							{title != null ? (
								typeof title === "string" || typeof title === "number" ? (
									<h2 className="ui-title-section">{title}</h2>
								) : (
									<div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
								)
							) : null}
							{count != null ? (
								<span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--text-secondary)]">
									{count}
								</span>
							) : null}
						</div>
						{description != null ? (
							typeof description === "string" || typeof description === "number" ? (
								<p className="mt-0.5 max-w-2xl text-[12.5px] text-[var(--text-muted)]">{description}</p>
							) : (
								<div className="mt-0.5 max-w-2xl text-[12.5px] text-[var(--text-muted)]">{description}</div>
							)
						) : null}
					</div>
					{actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
				</div>
			)}
			<div
				data-list-panel-body
				className={`divide-y divide-[var(--border-subtle)] ${bodyClassName}`}
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
			className={`px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] sm:px-5 ${
				interactive ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]" : ""
			} ${className}`}
		>
			{children}
		</div>
	);
}

/**
 * Titled card for create forms and secondary blocks: Card chrome with a
 * 16px rhythm between its children.
 */
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
		<div data-surface-panel data-card className={`space-y-4 p-5 ${className}`}>
			{(title || actions) && (
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						{title ? <h2 className="ui-title-section">{title}</h2> : null}
						{description ? <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-muted)]">{description}</p> : null}
					</div>
					{actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
				</div>
			)}
			{children}
		</div>
	);
}

/* ── PermissionDenied ───────────────────────────────────────────────── */

/* ── StatusScreen ───────────────────────────────────────────────────── */
/**
 * A whole-area message instead of page content: not found, offline, an error
 * boundary, missing permission. Every one of them has the same anatomy, so
 * they share this layout.
 */
export function StatusScreen({
	icon,
	tone = "neutral",
	eyebrow,
	title,
	titleAs: Title = "h1",
	titleId,
	description,
	details,
	actions,
	className,
}: {
	icon?: ReactNode;
	tone?: "neutral" | "danger";
	eyebrow?: ReactNode;
	title: ReactNode;
	titleAs?: "h1" | "h2";
	titleId?: string;
	description?: ReactNode;
	/** Supporting block under the description (error id, notice). */
	details?: ReactNode;
	actions?: ReactNode;
	className?: string;
}) {
	return (
		<div data-status-screen className={cn("flex min-h-[60dvh] items-center justify-center px-4 py-12 text-center", className)}>
			<div className="w-full max-w-md">
				{icon ? (
					<div
						aria-hidden="true"
						className={cn(
							"mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border shadow-[var(--shadow-xs)] [&>svg]:h-[22px] [&>svg]:w-[22px]",
							tone === "danger"
								? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]"
								: "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]",
						)}
					>
						{icon}
					</div>
				) : null}
				{eyebrow ? <p className="ui-eyebrow text-[var(--accent)]">{eyebrow}</p> : null}
				<Title id={titleId} className={cn("ui-title-page break-words", eyebrow ? "mt-1.5" : null)}>{title}</Title>
				{description ? <div className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{description}</div> : null}
				{details ? <div className="mt-4">{details}</div> : null}
				{actions ? <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div> : null}
			</div>
		</div>
	);
}

export function PermissionDenied() {
	return (
		<PageShell>
			<StatusScreen
				icon={
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
						<rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
						<path d="M7 11V7a5 5 0 0 1 10 0v4" />
					</svg>
				}
				title={<LocalizedText textKey="common.noPermission" fallback="Missing permission" />}
			/>
		</PageShell>
	);
}
