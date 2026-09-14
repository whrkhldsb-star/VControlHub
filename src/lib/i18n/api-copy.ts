import { AsyncLocalStorage } from "node:async_hooks";
import { en, zh } from "./dictionaries/api-copy";
import { interpolate, type Locale } from "./core";
export type { Locale } from "./core";

const localeStore = new AsyncLocalStorage<Locale>();
const reverse: Map<string, keyof typeof en> = new Map(Object.entries(en).map(([key, value]) => [value, key as keyof typeof en]));
const templateEntries = Object.entries(en).filter(([, value]) => /\{v\d+\}/.test(value));

export function withApiCopyLocale<T>(locale: Locale, callback: () => T): T {
  return localeStore.run(locale, callback);
}

export function apiCopy(key: keyof typeof en | string, vars?: Record<string, string | number>): string {
  const locale = localeStore.getStore() ?? "en";
  const value = (locale === "zh" ? (zh as Record<string, string>)[key] : (en as Record<string, string>)[key]) ?? key;
  return interpolate(value, vars);
}

/** Translate legacy `errorMessage` options evaluated before the route callback. */
export function localizeApiCopy(text: string, locale: Locale = localeStore.getStore() ?? "en"): string {
  const exact = reverse.get(text) as keyof typeof en | undefined;
  if (exact) return locale === "zh" ? interpolate((zh as Record<string, string>)[exact] ?? text) : text;
  for (const [key, template] of templateEntries) {
    const parts = template.split(/(\{v\d+\})/g).map((part) => part.startsWith("{v") ? "(.+?)" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const match = text.match(new RegExp(`^${parts.join("")}$`));
    if (!match) continue;
    if (locale !== "zh") return text;
    const values: Record<string, string> = {};
    [...template.matchAll(/\{(v\d+)\}/g)].forEach((item, index) => { values[item[1]!] = match[index + 1]!; });
    return interpolate((zh as Record<string, string>)[key] ?? text, values);
  }
  return text;
}

export { en, zh } from "./dictionaries/api-copy";
