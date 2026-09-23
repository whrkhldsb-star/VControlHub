import type { Locale } from "@/lib/i18n/core";
import { APP_TIME_ZONE } from "./time-zone";

export { APP_TIME_ZONE } from "./time-zone";

// Locale-aware formatter cache — fixed keys only (date/time/datetime × locale).
// Avoids unbounded growth from ad-hoc option object literals.
type FormatterKind = "date" | "time" | "datetime" | "short-date" | "short-time";
const FORMATTER_OPTIONS: Record<FormatterKind, Intl.DateTimeFormatOptions> = {
  datetime: {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  },
  date: {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  },
  time: {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  },
  "short-date": {
    month: "2-digit",
    day: "2-digit",
  },
  "short-time": {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  },
};
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getCachedFormatter(locale: Locale, kind: FormatterKind): Intl.DateTimeFormat {
  const key = `${locale}-${kind}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      timeZone: APP_TIME_ZONE,
      ...FORMATTER_OPTIONS[kind],
    });
    formatterCache.set(key, fmt);
  }
  return fmt;
}

function toDate(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Locale-aware date-time format */
export function formatDateTime(value: Date | string | number | null | undefined, locale: Locale, fallback = "—") {
  const date = toDate(value);
  if (!date) return fallback;
  return getCachedFormatter(locale, "datetime").format(date);
}

/** Locale-aware date format */
export function formatDate(value: Date | string | number | null | undefined, locale: Locale, fallback = "—") {
  const date = toDate(value);
  if (!date) return fallback;
  return getCachedFormatter(locale, "date").format(date);
}

/** Locale-aware time format */
export function formatTime(value: Date | string | number | null | undefined, locale: Locale, fallback = "—") {
  const date = toDate(value);
  if (!date) return fallback;
  return getCachedFormatter(locale, "time").format(date);
}

/** Compact month/day label for charts and dense tables. */
export function formatShortDate(value: Date | string | number | null | undefined, locale: Locale, fallback = "—") {
  const date = toDate(value);
  return date ? getCachedFormatter(locale, "short-date").format(date) : fallback;
}

/** Compact hour/minute label for charts and dense tables. */
export function formatShortTime(value: Date | string | number | null | undefined, locale: Locale, fallback = "—") {
  const date = toDate(value);
  return date ? getCachedFormatter(locale, "short-time").format(date) : fallback;
}
