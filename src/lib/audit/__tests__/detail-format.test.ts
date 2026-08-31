import { describe, expect, it } from "vitest";

/**
 * Tests for the audit `detail` renderer.
 *
 * This exists because `String(value)` collapses every nested object to
 * "[object Object]", and audit details nest routinely — `{ mode: { from, to } }`
 * for a settings change, zod issue arrays, playbook step lists. Both the audit
 * table and the CSV export render through here, so a regression silently turns
 * the audit trail into rows that record that *something* changed without
 * recording what.
 */
import { auditDetailEntries, formatAuditDetail, formatAuditDetailValue } from "../detail-format";

describe("formatAuditDetailValue", () => {
	it.each([
		["a string", "a string"],
		[42, "42"],
		[0, "0"],
		[true, "true"],
		[false, "false"],
	])("renders the scalar %s as-is", (value, expected) => {
		expect(formatAuditDetailValue(value)).toBe(expected);
	});

	it("distinguishes null from undefined instead of rendering both as empty", () => {
		expect(formatAuditDetailValue(null)).toBe("null");
		expect(formatAuditDetailValue(undefined)).toBe("undefined");
	});

	it("serialises a nested object to JSON rather than [object Object]", () => {
		expect(formatAuditDetailValue({ from: "a", to: "b" })).toBe('{"from":"a","to":"b"}');
	});

	it("serialises an array, including one of objects", () => {
		expect(formatAuditDetailValue([1, 2])).toBe("[1,2]");
		expect(formatAuditDetailValue([{ path: "x" }])).toBe('[{"path":"x"}]');
	});

	it("survives a circular structure instead of throwing inside the audit view", () => {
		// A DB row cannot be circular, but a caller can hand one straight in — and
		// a throw here would blank the whole audit page, not just one cell.
		const circular: Record<string, unknown> = { name: "x" };
		circular.self = circular;
		expect(() => formatAuditDetailValue(circular)).not.toThrow();
	});

	it("keeps unicode readable rather than escaping it", () => {
		expect(formatAuditDetailValue({ note: "备份完成" })).toBe('{"note":"备份完成"}');
	});
});

describe("auditDetailEntries", () => {
	it("returns an empty list for a null or undefined detail", () => {
		expect(auditDetailEntries(null)).toEqual([]);
		expect(auditDetailEntries(undefined)).toEqual([]);
		expect(auditDetailEntries({})).toEqual([]);
	});

	it("emits one key=value fragment per field, preserving insertion order", () => {
		expect(auditDetailEntries({ serverId: "srv_1", ok: true })).toEqual(["serverId=srv_1", "ok=true"]);
	});

	it("renders a nested change record legibly", () => {
		expect(auditDetailEntries({ mode: { from: "recommendation", to: "autonomous" } })).toEqual([
			'mode={"from":"recommendation","to":"autonomous"}',
		]);
	});
});

describe("formatAuditDetail", () => {
	it("joins the fragments with ', ' by default", () => {
		expect(formatAuditDetail({ a: 1, b: 2 })).toBe("a=1, b=2");
	});

	it("accepts a custom separator for the CSV export", () => {
		expect(formatAuditDetail({ a: 1, b: 2 }, " | ")).toBe("a=1 | b=2");
	});

	it("returns an empty string for an empty detail", () => {
		expect(formatAuditDetail(null)).toBe("");
	});
});
