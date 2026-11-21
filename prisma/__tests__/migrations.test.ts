import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isAutomaticMigration } from "../../deploy/check-upgrade-migrations.mjs";

describe("Prisma migrations", () => {
  it("accepts unbound legacy conversations and scan logs during automatic upgrades", async () => {
    const sql = await readFile(
      path.resolve(__dirname, "../migrations/20261121090000_ai_conversation_team_ops_job/migration.sql"), "utf8",
    );
    expect(isAutomaticMigration(sql)).toBe(true);
    expect(sql).toContain('ALTER TABLE "ai_conversations" ADD COLUMN "teamId" TEXT;');
    expect(sql).toContain('ALTER TABLE "ai_ops_logs" ADD COLUMN "jobId" TEXT;');
  });

  it("uses the mapped alert_rules table name when adding alert duration tracking", async () => {
    const migration = await readFile(
      path.resolve(__dirname, "../migrations/20260525015200_add_alert_rule_last_matched_at/migration.sql"),
      "utf8",
    );

    expect(migration).toContain('ALTER TABLE "alert_rules" ADD COLUMN "lastMatchedAt" TIMESTAMP(3);');
    expect(migration).not.toContain('ALTER TABLE "AlertRule"');
  });
});
