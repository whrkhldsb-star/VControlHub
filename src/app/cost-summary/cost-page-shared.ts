import type { CostCategory, CostCurrency } from "@/lib/cost/types";
import { UI_INPUT, UI_LABEL } from "@/lib/ui/classes";
import { isCalendarDate } from "@/lib/cost/calendar-date";
import { appTimeZoneDateKey } from "@/lib/datetime/time-zone";

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
		// Today in application time: before 08:00 in UTC+8 the UTC date is still yesterday.
		effectiveDate: appTimeZoneDateKey(),
		notes: "",
	};
}

export function isValidDate(s: string): boolean {
	return isCalendarDate(s);
}
