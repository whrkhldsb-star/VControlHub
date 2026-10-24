import { prisma } from "@/lib/db";

export type PlatformLocaleDefault = "zh" | "en";
export type PlatformThemeDefault = "dark" | "light";
export type PlatformDefaults = { locale: PlatformLocaleDefault; theme: PlatformThemeDefault };

const FALLBACK: PlatformDefaults = { locale: "zh", theme: "dark" };
const TTL_MS = 15_000;
let cached: { value: PlatformDefaults; loadedAt: number } | null = null;
// Bumped when a save invalidates the cache: a read started before the save
// must not cache the old defaults again for another 15 s.
let generation = 0;

/**
 * Locale and theme for a visitor who has not chosen one yet (login page, first
 * visit). Read once per process every 15 s: the root layout runs on every
 * request. Never throws: without a database the built-in defaults apply.
 */
export async function getPlatformDefaults(): Promise<PlatformDefaults> {
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached.value;
  const started = generation;
  let value = FALLBACK;
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: ["platform.defaultLocale", "platform.defaultTheme"] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((row) => [row.key, row.value]));
    const locale = map.get("platform.defaultLocale");
    const theme = map.get("platform.defaultTheme");
    value = {
      locale: locale === "en" ? "en" : "zh",
      theme: theme === "light" ? "light" : "dark",
    };
  } catch {
    value = FALLBACK;
  }
  if (started === generation) cached = { value, loadedAt: Date.now() };
  return value;
}

export function invalidatePlatformDefaults() {
  generation += 1;
  cached = null;
}
