// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AUDIT_EXPORT_MAX_ROWS, prepareAuditExport } from "../service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("audit export boundaries in PostgreSQL", () => {
  const action = "test.audit.export." + randomUUID();
  const timestamp = new Date("2026-01-01T00:00:00Z");
  let ready = false;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("Disposable database required");
    }
    // Equal timestamps deliberately span every batch boundary.
    await prisma.$executeRaw`INSERT INTO audit_logs (id, "actorType", action, severity, detail, "createdAt")
      SELECT ${action} || lpad(n::text, 6, '0'), 'SYSTEM', ${action}, 'INFO', '{}', ${timestamp}
      FROM generate_series(1, ${AUDIT_EXPORT_MAX_ROWS}::int) AS n`;
    ready = true;
  });

  afterAll(async () => {
    if (ready) await prisma.auditLog.deleteMany({ where: { action } });
    await prisma.$disconnect();
  });

  it("distinguishes exactly 50,000 matches from one extra and never repeats a cursor row", async () => {
    const exact = await prepareAuditExport({ action });
    expect(exact.truncated).toBe(false);
    // Insert a newer row after preparing the exact export. Each export keeps its own upper bound.
    const added = await prisma.auditLog.create({ data: {
      id: action + "-new", action, actorType: "SYSTEM", detail: {}, createdAt: new Date(timestamp.getTime() + 1),
    } });
    const overflow = await prepareAuditExport({ action });
    expect(overflow.truncated).toBe(true);
    for (const [result, includesNewRow] of [[exact, false], [overflow, true]] as const) {
      const ids = new Set<string>();
      let emitted = 0;
      for await (const page of result.batches) {
        expect(page.length).toBeLessThanOrEqual(1000);
        for (const row of page) ids.add(row.id);
        emitted += page.length;
      }
      expect(emitted).toBe(AUDIT_EXPORT_MAX_ROWS);
      expect(ids.size).toBe(emitted);
      expect(ids.has(added.id)).toBe(includesNewRow);
      expect(ids.has(action + "000001")).toBe(!includesNewRow);
    }
  }, 45_000);
});
