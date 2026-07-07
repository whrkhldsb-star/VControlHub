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

// Locale-aware formatter cache
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getCachedFormatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}-${JSON.stringify(options)}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      timeZone: APP_TIME_ZONE,
      ...options,
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
  return getCachedFormatter(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/** Locale-aware date format */
export function formatDate(value: Date | string | number | null | undefined, locale: Locale, fallback = "—") {
  const date = toDate(value);
  if (!date) return fallback;
  return getCachedFormatter(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Locale-aware time format */
export function formatTime(value: Date | string | number | null | undefined, locale: Locale, fallback = "—") {
  const date = toDate(value);
  if (!date) return fallback;
  return getCachedFormatter(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
