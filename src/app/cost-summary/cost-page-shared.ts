import type { CostCategory, CostCurrency } from "@/lib/cost/types";

export const CATEGORIES: CostCategory[] = ["vps", "bandwidth", "storage", "other"];

export const cardClass = "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]";
export const labelClass = "text-xs font-medium tracking-wide text-[var(--text-secondary)]";
export const inputClass =
	"w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent-border)]";
export const buttonPrimary =
	"inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 [data-action-button]:inline-flex";
// Prefer data-action-button tokens for cost page chrome.
export const buttonGhost =
	"inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
export const buttonDanger =
	"inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

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

