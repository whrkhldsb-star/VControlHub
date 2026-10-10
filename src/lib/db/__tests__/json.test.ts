import { expect, it } from "vitest";
import { toJsonValue } from "../json";

type Finding = { title: string; severity?: "low" | "high"; tags: string[] };

it("accepts typed JSON-shaped values and rejects non-JSON ones at compile time", () => {
	const findings: Finding[] = [{ title: "disk", tags: ["ops"] }];
	expect(toJsonValue(findings)).toBe(findings);
	expect(toJsonValue({ nested: { ok: true, count: 1, missing: undefined } })).toEqual({ nested: { ok: true, count: 1, missing: undefined } });
	// @ts-expect-error Date is not JSON; store an ISO string instead.
	toJsonValue({ at: new Date(0) });
	// @ts-expect-error bigint does not serialize.
	toJsonValue({ size: 1n });
});
