// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isAutomaticMigration,
  largeIndexWarnings,
  LARGE_APPEND_ONLY_TABLES,
} from "../check-upgrade-migrations.mjs";

describe("large-table CREATE INDEX warnings (D-01)", () => {
  it("warns on a plain CREATE INDEX for every known large append-only table", () => {
    for (const table of LARGE_APPEND_ONLY_TABLES) {
      const warnings = largeIndexWarnings(`CREATE INDEX "x_idx" ON ${table}(id);`, "001_warn");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ migration: "001_warn", table });
      expect(warnings[0]!.statement).toContain("CREATE INDEX");
      expect(warnings[0]!.reason).toMatch(/blocks writes/i);
    }
  });

  it("detects schema-qualified, quoted, UNIQUE and IF NOT EXISTS variants", () => {
    const sql = [
      'CREATE UNIQUE INDEX "u" ON "notifications"("userId");',
      'CREATE INDEX IF NOT EXISTS "i" ON public."job_events" ("jobId");',
      "CREATE INDEX j ON job_events(jobId, createdAt);",
    ].join("\n");
    const warnings = largeIndexWarnings(sql, "002");
    expect(warnings.map((w) => w.table)).toEqual(["notifications", "job_events", "job_events"]);
  });

  it("does not warn for CONCURRENTLY builds, small tables or non-index statements", () => {
    expect(largeIndexWarnings('CREATE INDEX CONCURRENTLY "c" ON "job_events"(id);', "003")).toEqual([]);
    expect(largeIndexWarnings('CREATE INDEX CONCURRENTLY IF NOT EXISTS "c" ON "notifications"(id);', "003")).toEqual([]);
    expect(largeIndexWarnings('CREATE INDEX "s" ON "servers"(id);', "003")).toEqual([]);
    expect(largeIndexWarnings('ALTER TABLE "job_events" ADD COLUMN "source" TEXT;', "003")).toEqual([]);
    expect(largeIndexWarnings('DROP INDEX "x";', "003")).toEqual([]);
  });

  it("ignores comments and multi-statement boundaries, and the legacy un-mapped table names", () => {
    // A leading comment must not hide the statement; a semicolon inside a
    // string must not split it; the pre-map table name is not the mapped
    // large table (audit_logs only exists under its @@map name).
    const sql = [
      "-- created by hand",
      'CREATE INDEX IF NOT EXISTS "a_idx" ON "audit_logs"("createdAt");',
      "CREATE INDEX \"b\" ON \"AuditLog\"(\"createdAt\");",
      "CREATE INDEX \"s\" ON \"share_links\"('a;b');",
    ].join("\n");
    const warnings = largeIndexWarnings(sql, "004");
    expect(warnings.map((w) => w.table)).toEqual(["audit_logs"]);
  });

  it("keeps auto-approval intact: an additive migration on a large table still classifies as automatic", () => {
    // This is the D-01 contract: warnings are operational only and never
    // change the additive auto-approval verdict for existing migrations.
    const sql = 'ALTER TABLE "job_events" ADD COLUMN "source" TEXT;\nCREATE INDEX "job_events_source_idx" ON "job_events"("source");';
    expect(isAutomaticMigration(sql)).toBe(true);
    expect(largeIndexWarnings(sql, "005")).toHaveLength(1);
  });
});
