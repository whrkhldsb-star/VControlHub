import { describe, expect, it } from "vitest";

import { backupRetentionInputSchema } from "@/lib/backup/schema";

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
