import { cn } from "@/lib/ui/cn";
import { UI_INPUT } from "@/lib/ui/classes";
import type {
	ButtonHTMLAttributes,
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
			data-tone={tone}
			className={cn(
				"inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide",
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
	label = "Loading…",
}: {
	size?: "sm" | "md" | "lg";
	className?: string;
	/** Accessible name; pass a localized loading string from client call sites. */
	label?: string;
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

export function ProgressBar({
	value,
	max = 100,
	tone = "accent",
	className,
}: {
	value: number;
	max?: number;
	tone?: BadgeTone;
	className?: string;
}) {
	const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
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
			className={`h-2 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)] ${className ?? ""}`}
			role="progressbar"
			aria-valuenow={value}
			aria-valuemin={0}
			aria-valuemax={max}
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
			className={`relative h-5 w-10 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 ${
				checked ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"
			} ${className ?? ""}`}
		>
			<span
				aria-hidden
				className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-[var(--surface)] shadow transition-transform ${
					checked ? "translate-x-5" : ""
				}`}
			/>
		</button>
	);
}

export type StateBoxTone = "danger" | "warning" | "success" | "accent" | "neutral";

export function StateBox({
	tone = "neutral",
	children,
	className,
	...rest
}: {
	tone?: StateBoxTone;
	children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
	return (
		<div data-state-box={tone} className={`text-sm ${className ?? ""}`} {...rest}>
			{children}
		</div>
	);
}

/** Soft info / tip banner used under page headers. */
export function Callout({
	tone = "accent",
	title,
	children,
	className,
	action,
}: {
	tone?: "accent" | "warning" | "success" | "danger" | "neutral";
	title?: ReactNode;
	children?: ReactNode;
	className?: string;
	action?: ReactNode;
}) {
	const toneCls = {
		accent: "border-[var(--accent-border)] bg-[color-mix(in_srgb,var(--accent-bg)_55%,var(--surface))]",
		warning: "border-[var(--warning-border)] bg-[var(--warning-bg)]",
		success: "border-[var(--success-border)] bg-[var(--success-bg)]",
		danger: "border-[var(--danger-border)] bg-[var(--danger-bg)]",
		neutral: "border-[var(--border)] bg-[var(--surface-subtle)]",
	}[tone];
	return (
		<div
			data-callout
			className={`rounded-2xl border px-4 py-3.5 ${toneCls} ${className ?? ""}`}
		>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					{title ? (
						<div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
					) : null}
					{children ? (
						<div className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">{children}</div>
					) : null}
				</div>
				{action ? <div className="shrink-0">{action}</div> : null}
			</div>
		</div>
	);
}

export type SegmentedTabItem = {
	id: string;
	label: ReactNode;
	description?: ReactNode;
	icon?: ReactNode;
	badge?: ReactNode;
	disabled?: boolean;
};

/** Horizontal segmented control / tab strip — settings & list filters. */
export function SegmentedTabs({
	items,
	value,
	onChange,
	ariaLabel,
	className,
}: {
	items: SegmentedTabItem[];
	value: string;
	onChange: (id: string) => void;
	ariaLabel: string;
	className?: string;
}) {
	return (
		<div
			role="tablist"
			aria-label={ariaLabel}
			data-segmented-tabs
			className={`grid grid-cols-2 gap-1 rounded-2xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] p-1.5 shadow-[var(--shadow-sm)] backdrop-blur-md md:flex md:flex-wrap ${className ?? ""}`}
		>
			{items.map((item) => {
				const active = item.id === value;
				return (
					<button
						key={item.id}
						type="button"
						role="tab"
						aria-selected={active}
						disabled={item.disabled}
						onClick={() => onChange(item.id)}
						className={`group relative flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2.5 text-left text-sm font-medium transition md:min-w-[9.5rem] md:flex-1 md:px-3.5 ${
							active
								? "bg-[var(--accent-bg)] text-[var(--accent)] shadow-[var(--shadow-sm)]"
								: "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
						} disabled:cursor-not-allowed disabled:opacity-50`}
					>
						{item.icon ? (
							<span className="text-base leading-none" aria-hidden>
								{item.icon}
							</span>
						) : null}
						<span className="flex min-w-0 flex-1 flex-col items-start leading-tight">
							<span className="truncate">{item.label}</span>
							{item.description ? (
								<span
									className={`mt-0.5 hidden w-full truncate text-[10px] font-normal sm:block ${
										active ? "text-[var(--accent)] opacity-75" : "text-[var(--text-muted)]"
									}`}
								>
									{item.description}
								</span>
							) : null}
						</span>
						{item.badge != null ? (
							<span
								className={`ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
									active
										? "bg-[var(--accent)] text-[var(--on-accent)]"
										: "bg-[var(--surface-elevated)] text-[var(--text-muted)]"
								}`}
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
			className={`space-y-1 rounded-2xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_96%,transparent)] p-2 shadow-[var(--shadow-sm)] ${className ?? ""}`}
		>
			{items.map((item) => {
				const active = item.id === activeId;
				return (
					<button
						key={item.id}
						type="button"
						onClick={() => onSelect(item.id)}
						className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition ${
							active
								? "bg-[var(--accent-bg)] text-[var(--accent)]"
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
									className={`mt-0.5 block text-[11px] leading-4 ${
										active ? "text-[var(--accent)] opacity-80" : "text-[var(--text-muted)]"
									}`}
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
	return (
		<div
			data-form-field
			className={`space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-subtle)_55%,var(--surface))] p-3.5 transition focus-within:border-[var(--accent-border)] focus-within:bg-[var(--surface)] ${className ?? ""}`}
		>
			<div className="flex items-center justify-between gap-2">
				<label
					htmlFor={htmlFor}
					className="text-xs font-semibold tracking-wide text-[var(--text-primary)]"
				>
					{label}
				</label>
				{actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
			</div>
			{children}
			{error ? <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}
			{!error && hint ? <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-xs leading-5 text-[var(--text-muted)]">{hint}</p> : null}
		</div>
	);
}

export type NoticeTone = "info" | "success" | "warning" | "danger" | "neutral";

const NOTICE_STYLES: Record<NoticeTone, string> = {
	info: "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]",
	success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
	warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
	danger: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
	neutral: "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--text-secondary)]",
};

export function Notice({
	tone = "info", title, children, action, onDismiss, dismissLabel = "Dismiss", compact = false, className,
}: {
	tone?: NoticeTone;
	title?: ReactNode;
	children?: ReactNode;
	action?: { label: ReactNode; onClick: () => void; disabled?: boolean };
	onDismiss?: () => void;
	dismissLabel?: string;
	compact?: boolean;
	className?: string;
}) {
	return (
		<div role={tone === "danger" ? "alert" : "status"} data-notice-tone={tone} className={cn("flex items-start justify-between gap-3 rounded-xl border", compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm", NOTICE_STYLES[tone], className)}>
			<div className="min-w-0 flex-1">
				{title ? <div className="font-semibold text-current">{title}</div> : null}
				{children ? <div className={title ? "mt-1 leading-5" : "leading-5"}>{children}</div> : null}
			</div>
			{action || onDismiss ? <div className="flex shrink-0 items-center gap-2">
				{action ? <button type="button" onClick={action.onClick} disabled={action.disabled} className="font-semibold underline underline-offset-2 disabled:opacity-50">{action.label}</button> : null}
				{onDismiss ? <IconButton label={dismissLabel} onClick={onDismiss} className="h-7 w-7">×</IconButton> : null}
			</div> : null}
		</div>
	);
}

export function FormGrid({ children, columns = 2, className }: { children: ReactNode; columns?: 1 | 2 | 3; className?: string }) {
	const columnsClass = columns === 1 ? "grid-cols-1" : columns === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
	return <div data-form-grid className={cn("grid gap-4", columnsClass, className)}>{children}</div>;
}

export function CheckboxField({ label, hint, className, ...inputProps }: { label: ReactNode; hint?: ReactNode; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
	const accessibleLabel = inputProps["aria-label"] ?? (typeof label === "string" ? label : undefined);
	return <label className={cn("flex items-start gap-3 text-sm text-[var(--text-secondary)]", className)}>
		<input type="checkbox" aria-label={accessibleLabel} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" {...inputProps} />
		<span className="min-w-0"><span className="block font-medium text-[var(--text-primary)]">{label}</span>{hint ? <span className="mt-0.5 block text-xs leading-5 text-[var(--text-muted)]">{hint}</span> : null}</span>
	</label>;
}

export function IconButton({ label, tone = "neutral", children, className, ...rest }: { label: string; tone?: "neutral" | "danger" | "accent"; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">) {
	const toneClass = tone === "danger" ? "text-[var(--danger)] hover:bg-[var(--danger-bg)]" : tone === "accent" ? "text-[var(--accent)] hover:bg-[var(--accent-bg)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]";
	return <button type="button" aria-label={label} title={label} className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50", toneClass, className)} {...rest}>{children}</button>;
}
