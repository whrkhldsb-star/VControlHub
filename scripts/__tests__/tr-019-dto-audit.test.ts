/**
 * scripts/__tests__/tr-019-dto-audit.test.ts
 *
 * Unit tests for the TR-019 DTO boundary audit's pure-function parser
 * (analyzeRoute, buildReport). These tests focus on source-level
 * verdicts so the script can be tested without touching the
 * filesystem.
 *
 * The audit's job: for every API route file, decide whether it
 * (a) imports the shared boundary module (covered), (b) has inline
 * zod schemas that should be migrated (gap), or (c) has no schema at
 * all (clean, excluded from coverage denominator).
 */
import { describe, expect, it } from "vitest";

import { analyzeRoute, buildReport } from "../tr-019-dto-audit";

describe("analyzeRoute — boundary import detection", () => {
  it("flags route as boundary-imported when it imports the boundary file", () => {
    const source = `
      import { z } from "zod";
      import { createBackupSchema } from "@/lib/backup/schema";
      const parsed = createBackupSchema.parse(body);
    `;
    const r = analyzeRoute(
      "/tmp/fake.ts",
      "backup",
      "schema.ts",
      source,
    );
    expect(r.importsBoundary).toBe(true);
    expect(r.verdict).toBe("boundary-imported");
  });

  it("flags route as inline-zod when it has z.object but no boundary import", () => {
    const source = `
      import { z } from "zod";
      const schema = z.object({ name: z.string() });
      export async function POST() {}
    `;
    const r = analyzeRoute(
      "/tmp/fake.ts",
      "storage",
      "schema.ts",
      source,
    );
    expect(r.importsBoundary).toBe(false);
    expect(r.hasInlineZod).toBe(true);
    expect(r.verdict).toBe("inline-zod");
    expect(r.inlineZodSites.length).toBe(1);
  });

  it("flags route as no-schema when it has neither import nor inline zod", () => {
    const source = `
      import { NextResponse } from "next/server";
      export async function GET() { return NextResponse.json({ ok: true }); }
    `;
    const r = analyzeRoute(
      "/tmp/fake.ts",
      "ai",
      "dto.ts",
      source,
    );
    expect(r.verdict).toBe("no-schema");
  });
});

describe("analyzeRoute — inline zod detection", () => {
  it("counts z.object and z.enum but ignores z.string/z.number (field descriptors)", () => {
    const source = `
      import { z } from "zod";
      const a = z.object({
        name: z.string().min(1),
        age: z.number().int(),
      });
      const b = z.enum(["A", "B"]);
      const c = z.string().optional();
    `;
    const r = analyzeRoute(
      "/tmp/fake.ts",
      "files",
      "dto.ts",
      source,
    );
    // Should find exactly 2 sites (a and b), not 5
    expect(r.inlineZodSites.length).toBe(2);
  });

  it("records line number for each inline site", () => {
    const source = `import { z } from "zod";
const a = z.object({ x: z.string() });
const b = z.enum(["Y", "N"]);`;
    const r = analyzeRoute(
      "/tmp/fake.ts",
      "command",
      "schema.ts",
      source,
    );
    expect(r.inlineZodSites[0]?.line).toBe(2);
    expect(r.inlineZodSites[1]?.line).toBe(3);
  });
});

describe("analyzeRoute — boundary import path matching", () => {
  it("matches the @/lib/MODULE/BOUNDARY import path with sub-extensions", () => {
    const source = `import { foo } from "@/lib/backup/schema";`;
    const r = analyzeRoute(
      "/tmp/fake.ts",
      "backup",
      "schema.ts",
      source,
    );
    expect(r.importsBoundary).toBe(true);
  });

  it("does not match a different module's boundary import", () => {
    const source = `import { foo } from "@/lib/storage/schema";`;
    const r = analyzeRoute(
      "/tmp/fake.ts",
      "backup",
      "schema.ts",
      source,
    );
    expect(r.importsBoundary).toBe(false);
  });

  it("does not match an unrelated import path", () => {
    const source = `import { foo } from "@/lib/something-else";`;
    const r = analyzeRoute(
      "/tmp/fake.ts",
      "ai",
      "dto.ts",
      source,
    );
    expect(r.importsBoundary).toBe(false);
  });
});

describe("buildReport — coverage math", () => {
  it("produces a valid report when run against the actual repo", () => {
    // buildReport scans the filesystem. This is a smoke test that
    // it does not throw and the 5 modules all come back.
    const report = buildReport(new Date("2026-06-16T00:00:00Z"));
    expect(report.generatedAt).toBe("2026-06-16T00:00:00.000Z");
    expect(report.modules.length).toBe(5);
    const moduleNames = report.modules.map((m) => m.module).sort();
    expect(moduleNames).toEqual([
      "ai",
      "backup",
      "command",
      "files",
      "storage",
    ]);
    for (const m of report.modules) {
      expect(m.boundaryFile).toBeTruthy();
      expect(m.totalRoutes).toBeGreaterThanOrEqual(0);
      expect(m.coveragePercent).toBeGreaterThanOrEqual(0);
      expect(m.coveragePercent).toBeLessThanOrEqual(100);
    }
  });
});
