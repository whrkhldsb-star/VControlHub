import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Prisma migrations", () => {
  it("uses the mapped alert_rules table name when adding alert duration tracking", async () => {
    const migration = await readFile(
      path.resolve(__dirname, "../migrations/20260525015200_add_alert_rule_last_matched_at/migration.sql"),
      "utf8",
    );

    expect(migration).toContain('ALTER TABLE "alert_rules" ADD COLUMN "lastMatchedAt" TIMESTAMP(3);');
    expect(migration).not.toContain('ALTER TABLE "AlertRule"');
  });
});
