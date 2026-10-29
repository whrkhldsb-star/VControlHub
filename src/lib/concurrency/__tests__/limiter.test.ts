import { describe, expect, it } from "vitest";

import { createLimiter } from "../limiter";

describe("createLimiter", () => {
	it("never runs more than the limit at once, and finishes everything in order of arrival", async () => {
		const limit = createLimiter(3);
		let active = 0;
		let peak = 0;
		const started: number[] = [];
		const results = await Promise.all(
			Array.from({ length: 10 }, (_, n) => limit(async () => {
				started.push(n);
				active += 1;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active -= 1;
				return n * 2;
			})),
		);
		expect(peak).toBe(3);
		expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
		expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it("frees its place when a task fails, and passes the failure on", async () => {
		const limit = createLimiter(1);
		await expect(limit(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
		await expect(limit(async () => "next")).resolves.toBe("next");
	});

	it("treats a limit below one as one", async () => {
		const limit = createLimiter(0);
		await expect(limit(async () => 1)).resolves.toBe(1);
	});
});
