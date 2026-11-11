/**
 * The language of a process that serves no request of its own.
 *
 * The worker words alert mail, Telegram and webhook notices, stored job
 * errors and notification fallbacks for people who are not looking at a
 * page; the terminal gateway words a notice before it knows the page's
 * language. Without this both used the helpers' built-in defaults (Chinese
 * for service copy, English for API copy) whatever the platform's default
 * language was.
 */
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

import { setBackgroundCopyLocale } from "./api-copy";

const logger = createLogger("background-locale");

const REFRESH_MS = 60_000;

/**
 * Make `platform.defaultLocale` this process's background language. Never
 * throws: when the setting cannot be read the process keeps the language it
 * has (the built-in defaults before the first successful read).
 */
export async function syncBackgroundCopyLocale(): Promise<void> {
	try {
		const row = await prisma.setting.findUnique({ where: { key: "platform.defaultLocale" }, select: { value: true } });
		// As the pages read it: anything but "en" is the built-in default.
		setBackgroundCopyLocale(row?.value === "en" ? "en" : "zh");
	} catch (error) {
		logger.warn("platform default language could not be read; keeping the current one", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Sync now, then every minute, so a change of the setting reaches the
 * process without a restart. Returns the function that stops it.
 */
export async function startBackgroundCopyLocaleSync(): Promise<() => void> {
	await syncBackgroundCopyLocale();
	const timer = setInterval(() => void syncBackgroundCopyLocale(), REFRESH_MS);
	timer.unref?.();
	return () => clearInterval(timer);
}
