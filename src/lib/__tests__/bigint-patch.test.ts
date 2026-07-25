import { describe, expect, it } from "vitest";

import "../bigint-patch";

describe("bigint-patch toJSON", () => {
	it("serializes safe integers as numbers", () => {
		expect(JSON.parse(JSON.stringify({ size: 42n }))).toEqual({ size: 42 });
		expect(JSON.parse(JSON.stringify({ size: BigInt(Number.MAX_SAFE_INTEGER) }))).toEqual({
			size: Number.MAX_SAFE_INTEGER,
		});
	});

	it("serializes unsafe integers as decimal strings", () => {
		const huge = BigInt(Number.MAX_SAFE_INTEGER) + 10n;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const raw = (BigInt.prototype as any).toJSON.call(huge);
		expect(typeof raw).toBe("string");
		expect(raw).toBe(huge.toString());
		const parsed = JSON.parse(JSON.stringify({ size: huge })) as { size: string };
		expect(typeof parsed.size).toBe("string");
		expect(parsed.size).toBe(huge.toString());
	});
});
