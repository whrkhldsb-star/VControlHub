import type { Locale } from "@/lib/i18n/translations";

export const APP_TIME_ZONE = "Asia/Shanghai";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// Locale-aware formatter cache — fixed keys only (date/time/datetime × locale).
// Avoids unbounded growth from ad-hoc option object literals.
type FormatterKind = "date" | "time" | "datetime" | "short-date" | "short-time" | "compact-datetime";
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
  "compact-datetime": {
    month: "2-digit",
    day: "2-digit",
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
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatZhDateTime(value: Date | string | number | null | undefined, fallback = "—") {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : fallback;
}

export function formatZhDate(value: Date | string | number | null | undefined, fallback = "—") {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : fallback;
}

export function formatZhTime(value: Date | string | number | null | undefined, fallback = "—") {
  const date = toDate(value);
  return date ? timeFormatter.format(date) : fallback;
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

/** Compact month/day + hour/minute label for audit-style rows. */
export function formatCompactDateTime(value: Date | string | number | null | undefined, locale: Locale, fallback = "—") {
  const date = toDate(value);
  return date ? getCachedFormatter(locale, "compact-datetime").format(date) : fallback;
}
