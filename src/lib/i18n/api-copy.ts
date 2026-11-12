import { AsyncLocalStorage } from "node:async_hooks";
import { registerServerCopyLocale } from "./ambient-locale";
// Loaded for its registration: wherever a request has a language, schema refusals can be put into it.
import "./schema-copy";
import { en, zh } from "./dictionaries/api-copy";
import { interpolate, type Locale } from "./core";
export type { Locale } from "./core";

const localeStore = new AsyncLocalStorage<Locale>();
const reverse: Map<string, keyof typeof en> = new Map(Object.entries(en).map(([key, value]) => [value, key as keyof typeof en]));
const templateEntries = Object.entries(en).filter(([, value]) => /\{v\d+\}/.test(value));

export function withApiCopyLocale<T>(locale: Locale, callback: () => T): T {
  return localeStore.run(locale, callback);
}

/** The locale of the API request being handled, or undefined outside one (workers, gateways). */
export function currentApiRequestLocale(): Locale | undefined {
  return localeStore.getStore();
}

/**
 * The language of copy written outside any request, for a process that
 * serves none: the worker words alert mail, stored job errors and notices
 * for people who are not looking at a page, in the platform's default
 * language (see background-locale.ts). Unset — the web process, tests — each
 * helper keeps its own default: Chinese for service copy, English for API
 * copy. The web process must stay unset: `localizeApiCopy` maps the English
 * text of a route's `errorMessage` option back to its key for the viewer.
 */
let backgroundLocale: Locale | undefined;

export function setBackgroundCopyLocale(locale: Locale | undefined): void {
  backgroundLocale = locale;
}

export function backgroundCopyLocale(): Locale | undefined {
  return backgroundLocale;
}

/** The language copy is written in right now: the request's, else the process's own. */
export function currentCopyLocale(): Locale | undefined {
  return localeStore.getStore() ?? backgroundLocale;
}

// Code shared with the browser asks through ambient-locale.ts (it cannot import this module).
registerServerCopyLocale(currentCopyLocale);

export function apiCopy(key: keyof typeof en | string, vars?: Record<string, string | number>): string {
  const locale = currentCopyLocale() ?? "en";
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

export { en } from "./dictionaries/api-copy";
