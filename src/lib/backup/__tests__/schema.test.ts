import { describe, expect, it } from "vitest";

import {
  backupTypeSchema,
  createBackupSchema,
  restoreBackupSchema,
  voidBackupSchema,
} from "../schema";

describe("backup schema", () => {
  describe("backupTypeSchema", () => {
    it("accepts each of the three documented backup types", () => {
      expect(backupTypeSchema.safeParse("DATABASE").success).toBe(true);
      expect(backupTypeSchema.safeParse("FILES").success).toBe(true);
      expect(backupTypeSchema.safeParse("FULL").success).toBe(true);
    });

    it("rejects unknown backup types with the Chinese invalid-type message", () => {
      const result = backupTypeSchema.safeParse("SNAPSHOT");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("备份类型无效");
      }
    });

    it("rejects empty and lowercase variants without ambiguity", () => {
      expect(backupTypeSchema.safeParse("").success).toBe(false);
      expect(backupTypeSchema.safeParse("database").success).toBe(false);
      expect(backupTypeSchema.safeParse(undefined).success).toBe(false);
    });
  });

  describe("createBackupSchema", () => {
    it("accepts a valid type without a note", () => {
      const result = createBackupSchema.safeParse({ type: "FULL" });
      expect(result.success).toBe(true);
    });

    it("trims surrounding whitespace from the optional note", () => {
      const result = createBackupSchema.safeParse({ type: "FILES", note: "  before upgrade  " });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.note).toBe("before upgrade");
      }
    });

    it("treats a whitespace-only note as omitted (undefined) so the record stores no note", () => {
      const result = createBackupSchema.safeParse({ type: "DATABASE", note: "   " });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.note).toBeUndefined();
      }
    });

    it("rejects unknown backup types with the Chinese invalid-type message", () => {
      const result = createBackupSchema.safeParse({ type: "ROOT" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("备份类型无效");
      }
    });

    it("rejects notes longer than 500 characters", () => {
      const result = createBackupSchema.safeParse({ type: "FULL", note: "x".repeat(501) });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("备注最多 500 个字符");
      }
    });
  });

  describe("restoreBackupSchema", () => {
    it("accepts the literal RESTORE confirmation", () => {
      const result = restoreBackupSchema.safeParse({ confirm: "RESTORE" });
      expect(result.success).toBe(true);
    });

    it("rejects any other confirmation value with the Chinese confirm-required message", () => {
      const result = restoreBackupSchema.safeParse({ confirm: "restore" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("恢复操作需要输入 RESTORE 确认");
      }
    });

    it("rejects missing confirm payload entirely", () => {
      const result = restoreBackupSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("voidBackupSchema", () => {
    it("accepts a non-empty void reason and trims surrounding whitespace", () => {
      const result = voidBackupSchema.safeParse({ reason: "  历史记录不再执行  " });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reason).toBe("历史记录不再执行");
      }
    });

    it("rejects empty void reasons with the Chinese empty-reason message", () => {
      const result = voidBackupSchema.safeParse({ reason: "" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("作废原因不能为空");
      }
    });

    it("rejects whitespace-only void reasons with the Chinese empty-reason message", () => {
      const result = voidBackupSchema.safeParse({ reason: "   " });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("作废原因不能为空");
      }
    });

    it("rejects void reasons longer than 500 characters", () => {
      const result = voidBackupSchema.safeParse({ reason: "x".repeat(501) });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("作废原因最多 500 个字符");
      }
    });
  });
});
