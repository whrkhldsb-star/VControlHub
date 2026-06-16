import { describe, expect, it } from "vitest";

import {
  createCommandTemplateSchema,
  updateCommandTemplateSchema,
} from "@/lib/command/schema";
import { backupRetentionInputSchema } from "@/lib/backup/schema";

describe("command template schemas (T38e)", () => {
  describe("createCommandTemplateSchema", () => {
    it("accepts the minimum required fields", () => {
      const result = createCommandTemplateSchema.safeParse({
        name: "deploy",
        command: "systemctl restart app",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("deploy");
        expect(result.data.command).toBe("systemctl restart app");
      }
    });

    it("accepts optional rollbackCommand, description, variables, tags", () => {
      const result = createCommandTemplateSchema.safeParse({
        name: "deploy",
        command: "systemctl restart app",
        rollbackCommand: "systemctl stop app",
        description: "重启 app 服务",
        variables: ["ENV", "TAG"],
        tags: ["prod", "ops"],
      });
      expect(result.success).toBe(true);
    });

    it("accepts rollbackCommand as null (explicit null)", () => {
      const result = createCommandTemplateSchema.safeParse({
        name: "deploy",
        command: "systemctl restart app",
        rollbackCommand: null,
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty name", () => {
      const result = createCommandTemplateSchema.safeParse({
        name: "",
        command: "systemctl restart app",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty command", () => {
      const result = createCommandTemplateSchema.safeParse({
        name: "deploy",
        command: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing name", () => {
      const result = createCommandTemplateSchema.safeParse({
        command: "systemctl restart app",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateCommandTemplateSchema", () => {
    it("requires id", () => {
      const result = updateCommandTemplateSchema.safeParse({
        name: "renamed",
      });
      expect(result.success).toBe(false);
    });

    it("accepts id only (no fields to update)", () => {
      const result = updateCommandTemplateSchema.safeParse({ id: "tpl_1" });
      expect(result.success).toBe(true);
    });

    it("accepts partial update with name", () => {
      const result = updateCommandTemplateSchema.safeParse({
        id: "tpl_1",
        name: "renamed",
      });
      expect(result.success).toBe(true);
    });

    it("accepts partial update with rollbackCommand null (clears rollback)", () => {
      const result = updateCommandTemplateSchema.safeParse({
        id: "tpl_1",
        rollbackCommand: null,
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty name when provided", () => {
      const result = updateCommandTemplateSchema.safeParse({
        id: "tpl_1",
        name: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty id", () => {
      const result = updateCommandTemplateSchema.safeParse({
        id: "",
        name: "renamed",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("backupRetentionInputSchema (T38e)", () => {
  it("accepts empty body (all fields optional)", () => {
    const result = backupRetentionInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts both fields", () => {
    const result = backupRetentionInputSchema.safeParse({
      olderThanDays: 30,
      keepLatestPerType: 3,
    });
    expect(result.success).toBe(true);
  });

  it("accepts only olderThanDays", () => {
    const result = backupRetentionInputSchema.safeParse({ olderThanDays: 90 });
    expect(result.success).toBe(true);
  });

  it("accepts only keepLatestPerType", () => {
    const result = backupRetentionInputSchema.safeParse({ keepLatestPerType: 5 });
    expect(result.success).toBe(true);
  });

  it("rejects negative olderThanDays (positive int required)", () => {
    const result = backupRetentionInputSchema.safeParse({ olderThanDays: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero olderThanDays (positive int required)", () => {
    const result = backupRetentionInputSchema.safeParse({ olderThanDays: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects olderThanDays > 3650 (10 years cap)", () => {
    const result = backupRetentionInputSchema.safeParse({ olderThanDays: 5000 });
    expect(result.success).toBe(false);
  });

  it("rejects negative keepLatestPerType (min 0)", () => {
    const result = backupRetentionInputSchema.safeParse({ keepLatestPerType: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects keepLatestPerType > 1000 (cap)", () => {
    const result = backupRetentionInputSchema.safeParse({ keepLatestPerType: 2000 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer olderThanDays", () => {
    const result = backupRetentionInputSchema.safeParse({ olderThanDays: 30.5 });
    expect(result.success).toBe(false);
  });
});
