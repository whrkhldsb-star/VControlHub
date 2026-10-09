type Translate = (key: string, vars?: Record<string, string | number>) => string;

const NUMBER = /^\d+$/;

/**
 * Plain-language reading of the common five-field cron shapes, in the
 * viewer's language. Returns null for anything else (and for malformed
 * input) so callers decide what to show instead of a guessed sentence.
 */
export function describeCron(expression: string, t: Translate): string | null {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) return null;
	const [min, hour, day, month, dow] = parts as [string, string, string, string, string];
	if (month !== "*" || day !== "*") return null;
	const time = () => `${hour}:${min.padStart(2, "0")}`;
	if (dow === "*") {
		if (min.startsWith("*/") && NUMBER.test(min.slice(2)) && hour === "*") return t("scheduledTasks.cron.everyMinutes", { minutes: min.slice(2) });
		if (min === "0" && hour === "*") return t("scheduledTasks.cron.hourly");
		if (NUMBER.test(min) && hour.startsWith("*/") && NUMBER.test(hour.slice(2))) return t("scheduledTasks.cron.everyHours", { hours: hour.slice(2), minute: min.padStart(2, "0") });
		if (NUMBER.test(min) && NUMBER.test(hour)) return t("scheduledTasks.cron.daily", { time: time() });
		return null;
	}
	if (NUMBER.test(dow) && NUMBER.test(min) && NUMBER.test(hour)) {
		return t("scheduledTasks.cron.weekly", { weekday: t(`scheduledTasks.weekday.${Number(dow) % 7}`), time: time() });
	}
	return null;
}

export function isFiveFieldCron(expression: string): boolean {
	return expression.trim().split(/\s+/).length === 5;
}
