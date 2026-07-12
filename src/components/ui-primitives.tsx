import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

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

export function Badge({ tone = "neutral", children, className, ...rest }: {
	tone?: BadgeTone;
	children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>) {
	return (
		<span
			data-tone={tone}
			className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${TONE_STYLES[tone]} ${className ?? ""}`}
			{...rest}
		>
			{children}
		</span>
	);
}

export function Card({ children, className, ...rest }: {
	children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
	return <div data-card className={className} {...rest}>{children}</div>;
}

export function Spinner({ size = "md", className }: {
	size?: "sm" | "md" | "lg";
	className?: string;
}) {
	const sizeClass = { sm: "h-4 w-4 border-2", md: "h-6 w-6 border-2", lg: "h-8 w-8 border-3" }[size];
	return (
		<span
			className={`inline-block animate-spin rounded-full border-current border-t-transparent text-[var(--accent)] ${sizeClass} ${className ?? ""}`}
			role="status"
			aria-label="Loading"
		/>
	);
}

export function ProgressBar({ value, max = 100, tone = "accent", className }: {
	value: number;
	max?: number;
	tone?: BadgeTone;
	className?: string;
}) {
	const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
	const color = {
		accent: "var(--accent)", success: "var(--success)", warning: "var(--warning)", danger: "var(--danger)",
		neutral: "var(--text-muted)", cyan: "var(--accent)", emerald: "var(--success)", rose: "var(--danger)",
		amber: "var(--warning)", sky: "var(--accent)", blue: "var(--accent)", violet: "var(--accent)",
	}[tone];
	return (
		<div
			className={`h-2 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)] ${className ?? ""}`}
			role="progressbar"
			aria-valuenow={value}
			aria-valuemin={0}
			aria-valuemax={max}
		>
			<div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${percentage}%`, backgroundColor: color }} />
		</div>
	);
}

export function Input({ className, hasError, ...rest }: {
	hasError?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			data-input
			data-error={hasError ? "true" : undefined}
			className={`block w-full px-3 py-2 text-sm placeholder:text-[var(--text-muted)] ${className ?? ""}`}
			{...rest}
		/>
	);
}

export type StateBoxTone = "danger" | "warning" | "success" | "accent" | "neutral";

export function StateBox({ tone = "neutral", children, className, ...rest }: {
	tone?: StateBoxTone;
	children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
	return <div data-state-box={tone} className={`text-sm ${className ?? ""}`} {...rest}>{children}</div>;
}
