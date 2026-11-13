import { describe, expect, it } from "vitest";

import { alertOperatorSign } from "../operator";

describe("alertOperatorSign", () => {
	it("writes each comparison a rule can store as a sign", () => {
		expect(["gt", "gte", "lt", "lte", "eq"].map(alertOperatorSign)).toEqual([">", "≥", "<", "≤", "="]);
	});

	it("shows anything else as it is", () => {
		expect(alertOperatorSign(">")).toBe(">");
		expect(alertOperatorSign("between")).toBe("between");
	});
});
