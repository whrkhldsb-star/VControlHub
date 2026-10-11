import { describe, expect, it } from "vitest";

import {
	appTimeZoneDateKey,
	shiftAppTimeZoneDay,
	startOfDayInAppTimeZone,
	startOfMonthInAppTimeZone,
	wallClockInAppTimeZone,
} from "../time-zone";

describe("application time zone day buckets", () => {
	// 2026-07-18T20:30Z is 04:30 on 19 July in Asia/Shanghai.
	const lateUtcEvening = new Date("2026-07-18T20:30:00Z");

	it("files an instant under the calendar day it shows on the application clock", () => {
		expect(wallClockInAppTimeZone(lateUtcEvening)).toMatchObject({ year: 2026, month: 7, day: 19, hour: 4, minute: 30 });
		expect(appTimeZoneDateKey(lateUtcEvening)).toBe("2026-07-19");
		expect(appTimeZoneDateKey(new Date("2026-07-18T15:59:59Z"))).toBe("2026-07-18");
	});

	it("starts days and months at midnight in the application time zone", () => {
		expect(startOfDayInAppTimeZone(lateUtcEvening).toISOString()).toBe("2026-07-18T16:00:00.000Z");
		expect(startOfMonthInAppTimeZone(lateUtcEvening).toISOString()).toBe("2026-06-30T16:00:00.000Z");
	});

	it("shifts by calendar days, across month ends", () => {
		expect(shiftAppTimeZoneDay(lateUtcEvening, 1).toISOString()).toBe("2026-07-19T16:00:00.000Z");
		expect(shiftAppTimeZoneDay(new Date("2026-08-01T02:00:00Z"), -1).toISOString()).toBe("2026-07-30T16:00:00.000Z");
		expect(appTimeZoneDateKey(shiftAppTimeZoneDay(lateUtcEvening, -89))).toBe("2026-04-21");
	});
});
