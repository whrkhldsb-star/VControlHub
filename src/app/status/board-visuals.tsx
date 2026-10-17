"use client";

/**
 * Small visual building blocks of the status board, in the spirit of
 * Komari's node cards: country flag, OS mark, colour-graded usage meters,
 * price and expiry badges, coloured tags, a live clock. Pure presentation;
 * every value comes from the public DTO.
 */
import { useEffect, useState, type ReactNode } from "react";

import { daysUntil, expiryTone, usageTone, type ExpiryTone } from "@/lib/public-status/billing";
import { formatPercent } from "@/lib/public-status/format";
import { countryFlag, countryName } from "@/lib/public-status/region-flag";
import { cn } from "@/lib/ui/cn";

type T = (key: string, vars?: Record<string, string | number>) => string;
type Locale = "zh" | "en";

const TONE_COLOR: Record<"success" | "warning" | "danger" | "neutral", string> = {
	success: "var(--success)",
	warning: "var(--warning)",
	danger: "var(--danger)",
	neutral: "var(--text-muted)",
};

export function CountryFlag({ code, locale, className }: { code: string | null | undefined; locale: Locale; className?: string }) {
	const flag = countryFlag(code);
	if (!flag || !code) return null;
	const name = countryName(code.toUpperCase(), locale);
	return (
		<span role="img" aria-label={name} title={name} className={cn("inline-block shrink-0 leading-none", className)}>
			{flag}
		</span>
	);
}

/**
 * Usage with a thin bar: green, amber from 60 %, red from 80 % (Komari's
 * thresholds); a muted track when unknown. Label, detail and percent share
 * the line above the bar.
 */
export function UsageMeter({ label, value, detail, compact = false, overflow = false }: {
	label: string;
	value: number | null | undefined;
	detail?: ReactNode;
	compact?: boolean;
	/** Show the true percentage above 100 (a traffic quota can be exceeded). */
	overflow?: boolean;
}) {
	const known = typeof value === "number" && Number.isFinite(value);
	const tone = usageTone(known ? value : null);
	const width = known ? Math.min(100, Math.max(0, value)) : 0;
	const shown = known ? (overflow ? Math.max(0, value) : width) : null;
	return (
		<div className="min-w-0" data-usage-meter>
			{label || detail ? (
				<div className={cn("flex items-baseline gap-2", compact ? "text-[11px]" : "text-xs")}>
					<span className="shrink-0 text-[var(--text-muted)]">{label}</span>
					<span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] tabular-nums text-[var(--text-muted)]">{detail}</span>
					<span className="shrink-0 font-mono font-semibold tabular-nums text-[var(--text-primary)]">{formatPercent(shown)}</span>
				</div>
			) : null}
			<div
				className={cn("overflow-hidden rounded-full bg-[var(--surface-elevated)]", label || detail ? "mt-1" : "", compact ? "h-1" : "h-1.5")}
				role={known ? "meter" : undefined}
				aria-label={label || undefined}
				aria-valuemin={known ? 0 : undefined}
				aria-valuemax={known ? 100 : undefined}
				aria-valuenow={known ? Math.round(width) : undefined}
			>
				<div
					className="h-full origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none"
					style={{ width: "100%", transform: `scaleX(${width / 100})`, background: TONE_COLOR[tone] }}
				/>
			</div>
		</div>
	);
}

/** A coloured dot that reads as the node's state at a glance. */
export function StatusDot({ status, label, decorative = false }: { status: string; label: string; /** The state is spelled out next to it. */ decorative?: boolean }) {
	const color = status === "online"
		? "var(--success)"
		: status === "offline"
			? "var(--danger)"
			: status === "stale"
				? "var(--warning)"
				: status === "maintenance"
					? "var(--info)"
					: "var(--text-muted)";
	return (
		<span className="relative inline-flex h-2.5 w-2.5 shrink-0" title={label} aria-hidden={decorative || undefined}>
			{status === "online" ? (
				<span aria-hidden className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 motion-reduce:animate-none" style={{ background: color }} />
			) : null}
			<span aria-hidden className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
			{decorative ? null : <span className="sr-only">{label}</span>}
		</span>
	);
}

const OS_MARKS: Array<{ match: RegExp; mark: string; color: string }> = [
	{ match: /ubuntu/i, mark: "U", color: "#E95420" },
	{ match: /debian/i, mark: "D", color: "#A81D33" },
	{ match: /centos/i, mark: "C", color: "#932279" },
	{ match: /rocky/i, mark: "R", color: "#10B981" },
	{ match: /alma/i, mark: "A", color: "#0F4266" },
	{ match: /fedora/i, mark: "F", color: "#51A2DA" },
	{ match: /red ?hat|rhel/i, mark: "R", color: "#EE0000" },
	{ match: /arch/i, mark: "A", color: "#1793D1" },
	{ match: /alpine/i, mark: "A", color: "#0D597F" },
	{ match: /suse/i, mark: "S", color: "#73BA25" },
	{ match: /windows/i, mark: "W", color: "#0078D4" },
	{ match: /freebsd/i, mark: "F", color: "#AB2B28" },
	{ match: /mac ?os|darwin/i, mark: "M", color: "#555555" },
];

/** A small round mark for the OS family (first letter, brand colour) plus its text. */
export function OsMark({ os, size = "md" }: { os: string; size?: "sm" | "md" }) {
	const found = OS_MARKS.find((entry) => entry.match.test(os));
	const mark = found?.mark ?? (os.trim()[0] ?? "?").toUpperCase();
	return (
		<span
			aria-hidden
			className={cn(
				"inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
				size === "sm" ? "h-4 w-4 text-[9px]" : "h-5 w-5 text-[10px]",
			)}
			style={{ background: found?.color ?? "var(--text-muted)" }}
		>
			{mark}
		</span>
	);
}

const TAG_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

/** The same tag always gets the same colour. */
export function tagColor(tag: string): string {
	let hash = 0;
	for (const char of tag) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
	return TAG_COLORS[hash % TAG_COLORS.length]!;
}

export function TagChip({ tag }: { tag: string }) {
	const color = tagColor(tag);
	return (
		<span
			className="inline-flex max-w-full items-center truncate rounded-full border px-2 py-px text-[11px] font-medium"
			style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
		>
			{tag}
		</span>
	);
}

const CURRENCY_SYMBOL: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€", JPY: "JP¥", HKD: "HK$" };

export function formatPrice(amount: number, currency: string): string {
	const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
	const digits = Number.isInteger(amount) ? 0 : 2;
	return `${symbol}${amount.toFixed(digits)}`;
}

const BADGE_TONE: Record<ExpiryTone, string> = {
	success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
	warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
	danger: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
	neutral: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]",
};

export function PriceBadge({ amount, currency, t }: { amount: number; currency: string; t: T }) {
	return (
		<span className="inline-flex items-center rounded-full border border-[var(--indigo-border)] bg-[var(--indigo-bg)] px-2 py-px text-[11px] font-medium text-[var(--indigo)]">
			{t("publicStatus.billing.perMonth", { price: formatPrice(amount, currency) })}
		</span>
	);
}

/** "23 days left" — red within a week or once expired, amber within 15 days. */
export function ExpiryBadge({ expiresAt, nowMs, t }: { expiresAt: string; nowMs: number; t: T }) {
	const days = daysUntil(expiresAt, nowMs);
	const tone = expiryTone(days);
	const label = days < 0
		? t("publicStatus.billing.expiredFor", { days: -days })
		: days === 0
			? t("publicStatus.billing.expiresToday")
			: days > 3650
				? t("publicStatus.billing.longTerm")
				: t("publicStatus.billing.daysLeft", { days });
	return (
		<span title={expiresAt.slice(0, 10)} className={cn("inline-flex items-center rounded-full border px-2 py-px text-[11px] font-medium", BADGE_TONE[tone])}>
			{label}
		</span>
	);
}

/** Wall clock for the summary, ticking every second. */
export function LiveClock({ locale, initialMs }: { locale: Locale; initialMs: number }) {
	const [now, setNow] = useState(initialMs);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const date = new Date(now);
	const tag = locale === "zh" ? "zh-CN" : "en-US";
	return (
		<span className="inline-flex flex-col">
			<span className="font-mono tabular-nums" suppressHydrationWarning>
				{date.toLocaleTimeString(tag, { hour12: false })}
			</span>
			<span className="text-[11px] font-normal text-[var(--text-muted)]" suppressHydrationWarning>
				{date.toLocaleDateString(tag, { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })}
			</span>
		</span>
	);
}

/** Proportional strip of node states (online / stale / maintenance / unknown / offline). */
export function StateStrip({ parts, label }: { parts: Array<{ value: number; color: string; name: string }>; label: string }) {
	const total = parts.reduce((sum, part) => sum + part.value, 0);
	if (total === 0) return null;
	return (
		<div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]" role="img" aria-label={label}>
			{parts.filter((part) => part.value > 0).map((part) => (
				<span key={part.name} title={`${part.name} ${part.value}`} style={{ width: `${(part.value / total) * 100}%`, background: part.color }} />
			))}
		</div>
	);
}
