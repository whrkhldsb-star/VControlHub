import type { Locale } from "./translations";

export function toDateLocale(locale: Locale): string {
	return locale === "zh" ? "zh-CN" : "en-US";
}

export function toHtmlLang(locale: Locale): string {
	return locale === "zh" ? "zh-CN" : "en";
}
