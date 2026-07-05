import type { CostCategory, CostCurrency } from "@/lib/cost/types";

export const CATEGORIES: CostCategory[] = ["vps", "bandwidth", "storage", "other"];

export const cardClass = "rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.04] p-5";
export const labelClass = "text-xs font-medium text-[var(--text-secondary)] tracking-wide";
export const inputClass =
	"w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30";
export const buttonPrimary =
	"rounded-lg bg-[var(--color-action)]/80 hover:bg-[var(--color-action)] px-4 py-2 text-sm font-medium text-[var(--color-action-fg)] transition disabled:opacity-50 disabled:cursor-not-allowed";
export const buttonGhost =
	"rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] hover:bg-[var(--surface)]/[0.10] px-4 py-2 text-sm text-[var(--text-primary)] transition";
export const buttonDanger =
	"rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] hover:bg-[var(--danger-bg)] px-3 py-1.5 text-xs text-[var(--danger)] transition";

export function formatAmount(amount: string, currency: CostCurrency, locale: string): string {
	const num = Number(amount);
	if (!Number.isFinite(num)) return `${amount} ${currency}`;
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
		}).format(num);
	} catch {
		return `${num.toFixed(2)} ${currency}`;
	}
}

export function emptyForm(): {
	category: CostCategory;
	provider: string;
	amount: string;
	currency: CostCurrency;
	effectiveDate: string;
	notes: string;
} {
	return {
		category: "vps",
		provider: "",
		amount: "",
		currency: "CNY",
		effectiveDate: new Date().toISOString().slice(0, 10),
		notes: "",
	};
}

export function isValidDate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime());
}

