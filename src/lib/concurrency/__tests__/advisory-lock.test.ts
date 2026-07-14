import { describe, it, expect } from "vitest";
import { getLockKeys, hashToInt32 } from "../advisory-lock";

describe("advisory-lock service", () => {
	describe("getLockKeys", () => {
		it("returns stable k1 for known namespaces", () => {
			const { k1 } = getLockKeys("backup-restore", "abc");
			expect(k1).toBe(45057);
		});

		it("returns different k1 for different namespaces", () => {
			const a = getLockKeys("backup-restore", "abc");
			const b = getLockKeys("vps-backup-schedule", "abc");
			expect(a.k1).not.toBe(b.k1);
		});

		it("returns stable k2 for the same resource", () => {
			const a = getLockKeys("backup-restore", "resource-123");
			const b = getLockKeys("backup-restore", "resource-123");
			expect(a.k2).toBe(b.k2);
		});

		it("returns different k2 for different resources", () => {
			const a = getLockKeys("backup-restore", "resource-a");
			const b = getLockKeys("backup-restore", "resource-b");
			expect(a.k2).not.toBe(b.k2);
		});

		it("handles unknown namespace with hash", () => {
			const { k1 } = getLockKeys("unknown-namespace", "abc");
			expect(k1).toBe(hashToInt32("unknown-namespace"));
		});
	});

	describe("hashToInt32", () => {
		it("produces consistent values", () => {
			expect(hashToInt32("test")).toBe(hashToInt32("test"));
		});

		it("produces different values for different inputs", () => {
			expect(hashToInt32("a")).not.toBe(hashToInt32("b"));
		});
	});
});
