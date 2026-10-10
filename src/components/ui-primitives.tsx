import Link from "next/link";

import { cn } from "@/lib/ui/cn";
import { UI_INPUT, UI_LABEL } from "@/lib/ui/classes";
import { browserT } from "@/lib/i18n/browser-translations";
import { Children, cloneElement, isValidElement, Fragment } from "react";
import type {
	ButtonHTMLAttributes,
	Ref,
	HTMLAttributes,
	InputHTMLAttributes,
	ReactNode,
} from "react";

export type BadgeTone =
	| "accent"
	| "success"
	| "warning"
	| "danger"
	| "neutral"
	| "cyan"
	| "emerald"
	| "rose"
	| "amber"
	| "sky"
	| "blue"
	| "violet";

const TONE_STYLES: Record<BadgeTone, string> = {
	accent: "border-[var(--accent-border)] text-[var(--accent)]",
	success: "border-[var(--success-border)] text-[var(--success)]",
	warning: "border-[var(--warning-border)] text-[var(--warning)]",
	danger: "border-[var(--danger-border)] text-[var(--danger)]",
	neutral: "border-[var(--border)] text-[var(--text-muted)]",
	cyan: "border-[var(--accent-border)] text-[var(--accent)]",
	emerald: "border-[var(--success-border)] text-[var(--success)]",
	rose: "border-[var(--danger-border)] text-[var(--danger)]",
	amber: "border-[var(--warning-border)] text-[var(--warning)]",
	sky: "border-[var(--accent-border)] text-[var(--accent)]",
	blue: "border-[var(--accent-border)] text-[var(--accent)]",
	violet: "border-[var(--accent-border)] text-[var(--accent)]",
};

/**
 * `data-tone` supplies the tinted background, and globals.css only defines
 * `--tone-bg` for the seven hue names — so `tone="warning"` rendered the same
 * border and text as `tone="amber"` but with no background at all. Map the
 * semantic aliases onto their hue so the two spellings really are equivalent.
 */
const TONE_BACKGROUND_ALIAS: Partial<Record<BadgeTone, BadgeTone>> = {
	accent: "cyan",
	success: "emerald",
	warning: "amber",
	danger: "rose",
};

export function Badge({
	tone = "neutral",
	children,
	className,
	...rest
}: {
	tone?: BadgeTone;
	children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>) {
	return (
		<span
			data-tone={TONE_BACKGROUND_ALIAS[tone] ?? tone}
			className={cn(
				"inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4",
				TONE_STYLES[tone],
				className,
			)}
			{...rest}
		>
			{children}
		</span>
	);
}

export function Spinner({
	size = "md",
	className,
	label,
}: {
	size?: "sm" | "md" | "lg";
	className?: string;
	/**
	 * Accessible name — required so no English default can leak into the zh
	 * locale; call sites pass their localized loading string.
	 */
	label: string;
}) {
	const sizeClass = { sm: "h-4 w-4 border-2", md: "h-6 w-6 border-2", lg: "h-8 w-8 border-3" }[size];
	return (
		<span
			className={`inline-block animate-spin rounded-full border-current border-t-transparent text-[var(--accent)] ${sizeClass} ${className ?? ""}`}
			role="status"
			aria-label={label}
		/>
	);
}

/**
 * Inline loading indicator — Spinner + localized label in a centered row.
 * Use for client-side secondary loads (filter/refresh/dialog refetch) so
 * inline loading reads consistently instead of bare text / animate-pulse /
 * an EmptyState standing in for a spinner.
 */
export function InlineLoading({
	label,
	size = "sm",
	className,
}: {
	label: string;
	size?: "sm" | "md" | "lg";
	className?: string;
}) {
	return (
		<div className={cn("flex items-center justify-center gap-2 text-sm text-[var(--text-muted)]", className)}>
			<Spinner size={size} label={label} />
			<span aria-hidden>{label}</span>
		</div>
	);
}

export function ProgressBar({
	value,
	label,
	max = 100,
	tone = "accent",
	height = "md",
	className,
}: {
	value: number;
	label?: string;
	max?: number;
	tone?: BadgeTone;
	height?: "sm" | "md";
	className?: string;
}) {
	const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
	const safeValue = Number.isFinite(value) ? Math.min(safeMax, Math.max(0, value)) : 0;
	const percentage = (safeValue / safeMax) * 100;
	const color = {
		accent: "var(--accent)",
		success: "var(--success)",
		warning: "var(--warning)",
		danger: "var(--danger)",
		neutral: "var(--text-muted)",
		cyan: "var(--accent)",
		emerald: "var(--success)",
		rose: "var(--danger)",
		amber: "var(--warning)",
		sky: "var(--accent)",
		blue: "var(--accent)",
		violet: "var(--accent)",
	}[tone];
	return (
		<div
			className={`${height === "sm" ? "h-1" : "h-1.5"} w-full overflow-hidden rounded-full bg-[var(--surface-elevated)] ${className ?? ""}`}
			role="progressbar"
			aria-label={label}
			aria-valuenow={safeValue}
			aria-valuemin={0}
			aria-valuemax={safeMax}
		>
			<div
				className="h-full rounded-full transition-[width] duration-300 ease-out"
				style={{ width: `${percentage}%`, backgroundColor: color }}
			/>
		</div>
	);
}

/** Unified control chrome — alias of UI_INPUT so form fields stay one source. */
export const CONTROL_CLASS = UI_INPUT;

export function Input({
	className,
	hasError,
	...rest
}: {
	hasError?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			data-input
			data-error={hasError ? "true" : undefined}
			className={`${CONTROL_CLASS} ${hasError ? "border-[var(--danger)]" : ""} ${className ?? ""}`}
			{...rest}
		/>
	);
}



export function Switch({
	checked,
	onCheckedChange,
	label,
	disabled,
	id,
	className,
}: {
	checked: boolean;
	onCheckedChange: (next: boolean) => void;
	label: string;
	disabled?: boolean;
	id?: string;
	className?: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			id={id}
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onCheckedChange(!checked)}
			className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 ${
				checked ? "bg-[var(--color-action)]" : "bg-[var(--border-strong)]"
			} ${className ?? ""}`}
		>
			<span
				aria-hidden
				className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_#0000004d] transition-transform duration-150 ${
					checked ? "translate-x-4" : ""
				}`}
			/>
		</button>
	);
}

export type SegmentedTabItem = {
	id: string;
	label: ReactNode;
	description?: ReactNode;
	icon?: ReactNode;
	badge?: ReactNode;
	disabled?: boolean;
	/** Connect to an existing tabpanel without imposing page-specific IDs. */
	panelId?: string;
	tabId?: string;
};

/**
 * The look of one tab, shared by button tabs (SegmentedTabs) and link tabs
 * (TabNav) so both stay identical when either changes.
 */
export function tabItemClass(active: boolean, variant: "underline" | "pills" = "underline") {
	return cn(
		"group relative flex min-w-0 shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
		variant === "pills"
			? cn("min-h-[var(--control-height-sm)] rounded-md px-3", active
				? "bg-[var(--surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
				: "text-[var(--text-muted)] hover:text-[var(--text-primary)]")
			: cn("min-h-10 px-3 pb-2.5 pt-2", active
				? "text-[var(--text-primary)] after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-[var(--accent)]"
				: "text-[var(--text-muted)] hover:text-[var(--text-primary)]"),
	);
}

function tabListClass(variant: "underline" | "pills") {
	return variant === "pills"
		? "w-fit max-w-full gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-0.5"
		: "gap-1 border-b border-[var(--border)]";
}

/** Tabs that navigate between pages (links with aria-current), styled like SegmentedTabs. */
export function TabNav({
	items,
	ariaLabel,
	variant = "underline",
	className,
}: {
	items: Array<{ href: string; label: ReactNode; active: boolean; badge?: ReactNode }>;
	ariaLabel: string;
	variant?: "underline" | "pills";
	className?: string;
}) {
	return (
		<nav aria-label={ariaLabel} data-tab-nav className={cn("flex min-w-0 overflow-x-auto", tabListClass(variant), className)}>
			{items.map((item) => (
				<Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined} className={tabItemClass(item.active, variant)}>
					<span>{item.label}</span>
					{item.badge != null ? (
						<span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-elevated)] px-1.5 text-[11px] font-semibold tabular-nums text-[var(--text-muted)]">{item.badge}</span>
					) : null}
				</Link>
			))}
		</nav>
	);
}

/**
 * Tab strip. `underline` (default) for switching page sections; `pills` for a
 * compact segmented filter (e.g. All / Linux / Windows).
 */
export function SegmentedTabs({
	items,
	value,
	onChange,
	ariaLabel,
	className,
	variant = "underline",
}: {
	items: SegmentedTabItem[];
	value: string;
	onChange: (id: string) => void;
	ariaLabel: string;
	className?: string;
	variant?: "underline" | "pills";
}) {
	return (
		<div
			role="tablist"
			aria-label={ariaLabel}
			data-segmented-tabs
			data-variant={variant}
			className={cn("flex min-w-0 overflow-x-auto", tabListClass(variant), className)}
			onKeyDown={(event) => {
				const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
				const index = tabs.indexOf(event.target as HTMLButtonElement);
				if (index < 0 || tabs.length === 0) return;
				let next: number;
				if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
				else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
				else if (event.key === "Home") next = 0;
				else if (event.key === "End") next = tabs.length - 1;
				else return;
				event.preventDefault();
				tabs[next]?.focus();
				tabs[next]?.click();
			}}
		>
			{items.map((item) => {
				const active = item.id === value;
				return (
					<button
						key={item.id}
						type="button"
						role="tab"
						id={item.tabId}
						aria-selected={active}
						aria-controls={item.panelId}
						tabIndex={item.id === (items.find((tab) => tab.id === value && !tab.disabled)?.id ?? items.find((tab) => !tab.disabled)?.id) ? 0 : -1}
						disabled={item.disabled}
						onClick={() => onChange(item.id)}
						title={typeof item.description === "string" ? item.description : undefined}
						className={tabItemClass(active, variant)}
					>
						{item.icon ? (
							<span className={cn("text-base leading-none [&>svg]:h-4 [&>svg]:w-4", active ? "text-[var(--accent)]" : "")} aria-hidden>
								{item.icon}
							</span>
						) : null}
						<span>{item.label}</span>
						{item.badge != null ? (
							<span
								className={cn(
									"inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
									active ? "bg-[var(--accent-bg)] text-[var(--accent)]" : "bg-[var(--surface-elevated)] text-[var(--text-muted)]",
								)}
							>
								{item.badge}
							</span>
						) : null}
					</button>
				);
			})}
		</div>
	);
}

export type SegmentedOption<T extends string> = {
	value: T;
	label: ReactNode;
	icon?: ReactNode;
	disabled?: boolean;
	title?: string;
	/** Accessible name when the visible label is shortened or hidden. */
	ariaLabel?: string;
	/** Colour of the selected state when choosing it deserves attention. */
	tone?: "warning" | "danger";
};

/**
 * One choice out of a few (TOTP / recovery code, filename / content), as a
 * group of toggle buttons with the same look as `SegmentedTabs variant="pills"`.
 * Use SegmentedTabs when the choice switches a panel; use this for a value.
 */
export function SegmentedControl<T extends string>({
	options,
	value,
	onChange,
	ariaLabel,
	size = "md",
	block = false,
	compactLabels = false,
	className,
}: {
	options: Array<SegmentedOption<T>>;
	value: T;
	onChange: (value: T) => void;
	ariaLabel: string;
	size?: "sm" | "md";
	/** Stretch to the container width with equal segments. */
	block?: boolean;
	/** Show only the icons on phones (options need an icon and ariaLabel). */
	compactLabels?: boolean;
	className?: string;
}) {
	return (
		<div
			role="group"
			aria-label={ariaLabel}
			data-segmented-control
			className={cn(
				"min-w-0 gap-0.5 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-0.5",
				block ? "flex w-full" : "inline-flex max-w-full",
				className,
			)}
		>
			{options.map((option) => {
				const active = option.value === value;
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={active}
						aria-label={option.ariaLabel}
						disabled={option.disabled}
						title={option.title}
						onClick={() => onChange(option.value)}
						className={cn(
							tabItemClass(active, "pills"),
							size === "sm" && "min-h-[var(--control-height-xs)] px-2.5 text-xs",
							block && "flex-1 justify-center",
							active && option.tone === "warning" && "text-[var(--warning)]",
							active && option.tone === "danger" && "text-[var(--danger)]",
							"[&>svg]:h-4 [&>svg]:w-4",
						)}
					>
						{option.icon}
						<span className={cn("truncate", compactLabels && option.icon ? "max-sm:sr-only" : undefined)}>{option.label}</span>
					</button>
				);
			})}
		</div>
	);
}

/** Vertical section rail for long settings / filter pages. */
export function SideNav({
	items,
	activeId,
	onSelect,
	ariaLabel,
	className,
}: {
	items: { id: string; label: ReactNode; description?: ReactNode; icon?: ReactNode }[];
	activeId?: string;
	onSelect: (id: string) => void;
	ariaLabel: string;
	className?: string;
}) {
	return (
		<nav
			aria-label={ariaLabel}
			data-side-nav
			className={`space-y-0.5 ${className ?? ""}`}
		>
			{items.map((item) => {
				const active = item.id === activeId;
				return (
					<button
						key={item.id}
						type="button"
						onClick={() => onSelect(item.id)}
						aria-current={active ? "location" : undefined}
						className={`relative flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition ${
							active
								? "bg-[var(--accent-soft)] text-[var(--text-primary)] before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--accent)]"
								: "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
						}`}
					>
						{item.icon ? (
							<span className="mt-0.5 text-base leading-none" aria-hidden>
								{item.icon}
							</span>
						) : null}
						<span className="min-w-0 flex-1">
							<span className="block text-sm font-medium">{item.label}</span>
							{item.description ? (
								<span
									className="mt-0.5 block text-xs leading-4 text-[var(--text-muted)]"
								>
									{item.description}
								</span>
							) : null}
						</span>
					</button>
				);
			})}
		</nav>
	);
}

/** Two-column settings / dense-form layout: rail + content. */
export function SplitPane({
	rail,
	children,
	className,
}: {
	rail: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			data-split-pane
			className={`grid gap-5 lg:grid-cols-[15.5rem_minmax(0,1fr)] xl:grid-cols-[16.5rem_minmax(0,1fr)] ${className ?? ""}`}
		>
			<div className="lg:sticky lg:top-4 lg:self-start">{rail}</div>
			<div className="min-w-0 space-y-5">{children}</div>
		</div>
	);
}

export function FormField({
	label,
	htmlFor,
	hint,
	error,
	actions,
	children,
	className,
}: {
	label: ReactNode;
	htmlFor?: string;
	hint?: ReactNode;
	error?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	const descriptionId = htmlFor && (error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined);
	const associate = (nodes: ReactNode): ReactNode => Children.map(nodes, (child) => {
		if (!isValidElement<{ id?: string; children?: ReactNode; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling" }>(child)) return child;
		if (htmlFor && child.props.id === htmlFor) {
			return cloneElement(child, {
				"aria-describedby": [child.props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined,
				"aria-invalid": error ? true : child.props["aria-invalid"],
			});
		}
		if ((typeof child.type === "string" || child.type === Fragment) && child.props.children) {
			return cloneElement(child, { children: associate(child.props.children) });
		}
		return child;
	});
	return (
		<div
			data-form-field
			className={`min-w-0 space-y-1.5 ${className ?? ""}`}
		>
			<div className="flex items-center justify-between gap-2">
				<label htmlFor={htmlFor} className={UI_LABEL}>
					{label}
				</label>
				{actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
			</div>
			{associate(children)}
			{error ? <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}
			{!error && hint ? <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-xs leading-5 text-[var(--text-muted)]">{hint}</p> : null}
		</div>
	);
}

export type NoticeTone = "info" | "success" | "warning" | "danger" | "neutral";

const NOTICE_STYLES: Record<NoticeTone, string> = {
	info: "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]",
	success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
	warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
	danger: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
	neutral: "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--text-secondary)]",
};

export function Notice({
	tone = "info", title, children, action, onDismiss, dismissLabel, compact = false, className, ...rest
}: {
	tone?: NoticeTone;
	title?: ReactNode;
	children?: ReactNode;
	action?: { label: ReactNode; onClick: () => void; disabled?: boolean };
	onDismiss?: () => void;
	/** Accessible name of the dismiss button — required when onDismiss is set. */
	dismissLabel?: string;
	compact?: boolean;
	className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "title" | "children" | "className">) {
	return (
		<div role={tone === "danger" ? "alert" : "status"} data-notice-tone={tone} className={cn("flex items-start justify-between gap-3 rounded-lg border", compact ? "px-3 py-2 text-xs" : "px-3.5 py-2.5 text-[13.5px]", NOTICE_STYLES[tone], className)} {...rest}>
			<div className="min-w-0 flex-1">
				{title ? <div className="font-semibold text-current">{title}</div> : null}
				{children ? <div className={cn("leading-5", title ? "mt-0.5 text-[var(--text-secondary)]" : undefined)}>{children}</div> : null}
			</div>
			{action || onDismiss ? <div className="flex shrink-0 items-center gap-2">
				{action ? <button type="button" onClick={action.onClick} disabled={action.disabled} className="font-semibold underline underline-offset-2 disabled:opacity-50">{action.label}</button> : null}
				{onDismiss ? <IconButton label={dismissLabel ?? browserT("common.close")} onClick={onDismiss} className="h-7 w-7">×</IconButton> : null}
			</div> : null}
		</div>
	);
}

export function FormGrid({ children, columns = 2, className }: { children: ReactNode; columns?: 1 | 2 | 3; className?: string }) {
	const columnsClass = columns === 1 ? "grid-cols-1" : columns === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
	return <div data-form-grid className={cn("grid gap-4", columnsClass, className)}>{children}</div>;
}

export function CheckboxField({ label, hint, className, variant = "plain", ...inputProps }: { label: ReactNode; hint?: ReactNode; className?: string; /** "tile" draws a selectable tile that highlights while checked. */ variant?: "plain" | "tile" } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
	const accessibleLabel = inputProps["aria-label"] ?? (typeof label === "string" ? label : undefined);
	const tile = variant === "tile";
	return <label
		data-tile={tile ? "" : undefined}
		data-selected={tile && inputProps.checked ? "" : undefined}
		className={cn("flex items-start gap-3 text-sm text-[var(--text-secondary)]", tile && "cursor-pointer px-3 py-2 transition", className)}
	>
		<input type="checkbox" aria-label={accessibleLabel} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" {...inputProps} />
		<span className="min-w-0"><span className="block font-medium text-[var(--text-primary)]">{label}</span>{hint ? <span className="mt-0.5 block text-xs leading-5 text-[var(--text-muted)]">{hint}</span> : null}</span>
	</label>;
}

export function IconButton({ label, tone = "neutral", children, className, ...rest }: { label: string; tone?: "neutral" | "danger" | "accent"; children: ReactNode; ref?: Ref<HTMLButtonElement> } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">) {
	const toneClass = tone === "danger" ? "text-[var(--danger)] hover:bg-[var(--danger-bg)]" : tone === "accent" ? "text-[var(--accent)] hover:bg-[var(--accent-bg)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]";
	return <button type="button" aria-label={label} title={label} className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50", toneClass, className)} {...rest}>{children}</button>;
}

export type ChipTone = "accent" | "warning" | "danger" | "success";

/**
 * Chip — a filter pill, a multi-select toggle or a suggestion. Pass
 * `selected` to make it a toggle (aria-pressed); leave it out for a plain
 * chip. The look is the [data-chip] rule in globals.css.
 *
 *   <Chip selected={tag === active} onClick={() => setActive(tag)}>{tag}</Chip>
 */
export function Chip({
	selected,
	tone = "accent",
	size = "sm",
	dashed = false,
	icon,
	children,
	className,
	type = "button",
	...rest
}: {
	selected?: boolean;
	tone?: ChipTone;
	size?: "sm" | "md";
	/** Dashed outline for "add" chips. */
	dashed?: boolean;
	icon?: ReactNode;
	children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed">) {
	return (
		<button
			type={type}
			data-chip=""
			data-size={size === "sm" ? undefined : size}
			data-chip-tone={tone === "accent" ? undefined : tone}
			data-dashed={dashed ? "" : undefined}
			aria-pressed={selected}
			className={cn(className)}
			{...rest}
		>
			{icon}
			{children}
		</button>
	);
}
