import type { CostCategory, CostCurrency } from "@/lib/cost/types";
import { UI_INPUT, UI_LABEL } from "@/lib/ui/classes";

export const CATEGORIES: CostCategory[] = ["vps", "bandwidth", "storage", "other"];

export const labelClass = UI_LABEL;
export const inputClass = UI_INPUT;

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
