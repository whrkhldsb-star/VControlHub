import { describe, expect, it } from "vitest";

import { en } from "@/lib/i18n/dictionaries/scheduled-tasks";
import { describeCron, isFiveFieldCron } from "../describe-cron";

const t = (key: string, vars?: Record<string, string | number>) =>
	(en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));

describe("describeCron", () => {
	it("reads the common shapes", () => {
		expect(describeCron("*/15 * * * *", t)).toBe("Every 15 minutes");
		expect(describeCron("0 * * * *", t)).toBe("Every hour on the hour");
		expect(describeCron("0 3 * * *", t)).toBe("Every day at 3:00");
		expect(describeCron("30 4 * * 0", t)).toBe("Every Sun at 4:30");
		expect(describeCron("30 4 * * 7", t)).toBe("Every Sun at 4:30");
	});

	it("reads hour steps instead of printing them as a clock time", () => {
		// Previously rendered as "Daily at */12:00".
		expect(describeCron("0 */12 * * *", t)).toBe("Every 12 hours at minute 00");
	});

	it("declines shapes it cannot state plainly", () => {
		expect(describeCron("0 3 1 * *", t)).toBeNull();
		expect(describeCron("0 3 * * 1-5", t)).toBeNull();
		expect(describeCron("0 3 * *", t)).toBeNull();
		expect(isFiveFieldCron("0 3 * *")).toBe(false);
	});
});
