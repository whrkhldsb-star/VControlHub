import { describe, expect, it } from "vitest";

import {
	auditDetailEntries,
	formatAuditDetail,
	formatAuditDetailValue,
} from "./detail-format";

describe("formatAuditDetailValue", () => {
	it("passes scalars through", () => {
		expect(formatAuditDetailValue("api")).toBe("api");
		expect(formatAuditDetailValue(3)).toBe("3");
		expect(formatAuditDetailValue(false)).toBe("false");
		expect(formatAuditDetailValue(null)).toBe("null");
		expect(formatAuditDetailValue(undefined)).toBe("undefined");
	});

	it("serialises nested values instead of rendering [object Object]", () => {
		// ai.ops.settings.update writes exactly this shape.
		expect(formatAuditDetailValue({ from: "auto", to: "manual" })).toBe(
			'{"from":"auto","to":"manual"}',
		);
		expect(formatAuditDetailValue(["ai.ops.mode", "ai.ops.provider"])).toBe(
			'["ai.ops.mode","ai.ops.provider"]',
		);
	});

	it("falls back to String() for a structure JSON cannot take", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(formatAuditDetailValue(circular)).toBe("[object Object]");
	});
});

describe("auditDetailEntries / formatAuditDetail", () => {
	it("renders one key=value fragment per field", () => {
		expect(auditDetailEntries({ teamId: "t1", rows: 2 })).toEqual([
			"teamId=t1",
			"rows=2",
		]);
	});

	it("joins with the caller's separator and tolerates an empty detail", () => {
		const detail = { mode: { from: "auto", to: "manual" }, actor: "alice" };
		expect(formatAuditDetail(detail)).toBe('mode={"from":"auto","to":"manual"}, actor=alice');
		expect(formatAuditDetail(detail, "; ")).toBe('mode={"from":"auto","to":"manual"}; actor=alice');
		expect(formatAuditDetail(null)).toBe("");
		expect(formatAuditDetail({})).toBe("");
	});
});
