/**
 * scripts/__tests__/rbac-audit.test.ts
 *
 * Unit tests for the rbac-audit cross-reference analyzer. The audit's job
 * is to detect drift between four RBAC sources of truth:
 *   1. `src/lib/auth/rbac.ts` — the PERMISSIONS tuple + role map
 *   2. `docs/route-catalog.json` — declaredPermissions per route/page
 *   3. `src/app/<all-ts-or-tsx>` — actual call sites (sessionHasPermission / requirePermission)
 *   4. Page-level button gating (variable assigned + downstream usage)
 *
 * These tests cover the pure-function exports. Tests that depend on the
 * real on-disk `src/lib/auth/rbac.ts` and `docs/route-catalog.json` are
 * guarded by file-exists checks so the suite can run on a fresh checkout
 * where those files may not exist (e.g. during tooling migration).
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadRbac,
  scanCallSites,
  buildUsage,
  buildMarkdown,
  type AuditReport,
  type CallSite,
  type Drift,
  type RouteCatalog,
  type RoleKey,
} from "../rbac-audit";

// ─── Helpers ───────────────────────────────────────────────────────────────

function minimalCatalog(overrides?: Partial<RouteCatalog>): RouteCatalog {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    summary: { pages: 0, apiRoutes: 0, permissionsDefined: 0 },
    apiRoutes: [],
    pages: [],
    permissions: [],
    ...overrides,
  };
}

function makeRoleMap(perms: string[]): Record<RoleKey, string[]> {
  return {
    admin: [...perms],
    operator: [],
    viewer: [],
    storage_manager: [],
  };
}

function makeReport(overrides?: Partial<AuditReport>): AuditReport {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    summary: {
      permissionsInList: 0,
      rolesDefined: 4,
      apiRoutesAudited: 0,
      pagesAudited: 0,
      callSitesAudited: 0,
      driftCount: 0,
      driftByCode: {
        "perm-not-in-list": 0,
        "perm-without-role": 0,
        "role-grants-unknown": 0,
        "api-no-declared-perm": 0,
        "api-decl-perm-unused": 0,
        "api-route-missing": 0,
        "page-button-perm-unused": 0,
      },
    },
    permissions: [],
    drifts: [],
    ...overrides,
  };
}

// ─── loadRbac — real rbac.ts fixture ───────────────────────────────────────

const RBAC_FIXTURE = join(process.cwd(), "src/lib/auth/rbac.ts");

describe("loadRbac — real rbac.ts fixture", () => {
  it("extracts all 46 permissions from the PERMISSIONS tuple", () => {
    if (!existsSync(RBAC_FIXTURE)) return; // skip if fixture missing
    const { permissions } = loadRbac();
    expect(permissions.length).toBe(46);
    expect(permissions).toContain("ai:chat");
    expect(permissions).toContain("command:execute");
    expect(permissions).toContain("storage:write");
    expect(permissions).toContain("playbook:manage");
    expect(permissions).toContain("cost:read");
    expect(permissions).toContain("cost:manage");
  });

  it("returns the admin role with all permissions via ALL_PERMISSIONS reference", () => {
    if (!existsSync(RBAC_FIXTURE)) return;
    const { roleMap } = loadRbac();
    expect(roleMap.admin.length).toBe(46);
    expect(roleMap.admin).toContain("ai:chat");
    expect(roleMap.admin).toContain("server:write");
    expect(roleMap.admin).toContain("playbook:read");
    expect(roleMap.admin).toContain("cost:read");
    expect(roleMap.admin).toContain("cost:manage");
  });

  it("returns a non-empty operator role map", () => {
    if (!existsSync(RBAC_FIXTURE)) return;
    const { roleMap } = loadRbac();
    expect(roleMap.operator.length).toBeGreaterThan(0);
    expect(roleMap.operator).toContain("backup:create");
    expect(roleMap.operator).toContain("command:execute");
    // operator should not have admin-only perms like `role:manage`
    expect(roleMap.operator).not.toContain("role:manage");
  });

  it("returns a non-empty viewer role map", () => {
    if (!existsSync(RBAC_FIXTURE)) return;
    const { roleMap } = loadRbac();
    expect(roleMap.viewer.length).toBeGreaterThan(0);
    // viewer should not have write permissions
    expect(roleMap.viewer).not.toContain("server:write");
    expect(roleMap.viewer).not.toContain("storage:delete");
  });

  it("returns a storage_manager role map", () => {
    if (!existsSync(RBAC_FIXTURE)) return;
    const { roleMap } = loadRbac();
    expect(roleMap.storage_manager.length).toBeGreaterThan(0);
    expect(roleMap.storage_manager).toContain("storage:read");
    expect(roleMap.storage_manager).toContain("storage:write");
  });
});

// ─── scanCallSites — synthetic in-memory fixtures ──────────────────────────

describe("scanCallSites — synthetic fixtures", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rbac-audit-test-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("finds sessionHasPermission call sites and extracts the permission string", () => {
    const file = join(tmp, "page.tsx");
    writeFileSync(
      file,
      [
        "import { sessionHasPermission } from '@/lib/auth/session';",
        "export default function Page() {",
        "  const canDelete = sessionHasPermission(session, \"server:write\");",
        "  return <div>{canDelete ? 'allowed' : 'denied'}</div>;",
        "}",
      ].join("\n"),
    );
    const sites = scanCallSites([file]);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.permission).toBe("server:write");
    expect(sites[0]!.kind).toBe("sessionHasPermission");
    expect(sites[0]!.variable).toBe("canDelete");
  });

  it("finds requirePermission call sites in API route handlers", () => {
    const file = join(tmp, "route.ts");
    writeFileSync(
      file,
      [
        "import { requirePermission } from '@/lib/auth/session';",
        "export async function POST() {",
        "  await requirePermission(\"server:write\");",
        "  return Response.json({ ok: true });",
        "}",
      ].join("\n"),
    );
    const sites = scanCallSites([file]);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.permission).toBe("server:write");
    expect(sites[0]!.kind).toBe("requirePermission");
    expect(sites[0]!.apiFile).toBeUndefined(); // no path comment
  });

  it("extracts the assigned variable name from const/let/var declarations", () => {
    const file = join(tmp, "page.tsx");
    writeFileSync(
      file,
      [
        "export default function Page() {",
        "  let canApprove = sessionHasPermission(session, \"command:approve\");",
        "  const canRead = sessionHasPermission(input.session, \"audit:read\");",
        "  return null;",
        "}",
      ].join("\n"),
    );
    const sites = scanCallSites([file]);
    expect(sites).toHaveLength(2);
    expect(sites[0]!.variable).toBe("canApprove");
    expect(sites[1]!.variable).toBe("canRead");
  });

  it("reports 1-based line numbers", () => {
    const file = join(tmp, "page.tsx");
    writeFileSync(
      file,
      [
        "// line 1", // 1
        "// line 2", // 2
        "export default function Page() {", // 3
        "  const x = sessionHasPermission(session, \"audit:read\");", // 4
        "  return null;", // 5
        "}", // 6
      ].join("\n"),
    );
    const sites = scanCallSites([file]);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.line).toBe(4);
  });

  it("does not match non-string permission arguments", () => {
    const file = join(tmp, "page.tsx");
    writeFileSync(
      file,
      [
        "export default function Page() {",
        "  // dynamic perm — not a string literal",
        "  const x = sessionHasPermission(session, getPerm());",
        "  return null;",
        "}",
      ].join("\n"),
    );
    const sites = scanCallSites([file]);
    expect(sites).toHaveLength(0);
  });

  it("handles multiple call sites on the same line (e.g. two adjacent statements)", () => {
    const file = join(tmp, "page.tsx");
    writeFileSync(
      file,
      [
        "export default function Page() {",
        "  const a = sessionHasPermission(session, \"storage:read\"); const b = sessionHasPermission(session, \"storage:write\");",
        "  return null;",
        "}",
      ].join("\n"),
    );
    const sites = scanCallSites([file]);
    expect(sites).toHaveLength(2);
    const perms = sites.map((s) => s.permission).sort();
    expect(perms).toEqual(["storage:read", "storage:write"]);
  });
});

// ─── buildUsage — drift detection in pure mode ────────────────────────────

describe("buildUsage — drift detection", () => {
  it("emits perm-not-in-list when a call site uses a permission not in PERMISSIONS", () => {
    const catalog = minimalCatalog();
    const callSites: CallSite[] = [
      { permission: "ghost:perm", kind: "sessionHasPermission", file: "x.tsx", line: 1 },
    ];
    const { drifts } = buildUsage(callSites, catalog, ["audit:read"], makeRoleMap(["audit:read"]));
    const code = drifts.find((d) => d.code === "perm-not-in-list");
    expect(code).toBeDefined();
    expect(code?.message).toContain("ghost:perm");
  });

  it("emits role-grants-unknown when a role grants a perm not in PERMISSIONS", () => {
    const catalog = minimalCatalog();
    const { drifts } = buildUsage(
      [],
      catalog,
      ["audit:read"],
      { admin: ["audit:read"], operator: ["phantom:perm"], viewer: [], storage_manager: [] },
    );
    const code = drifts.find((d) => d.code === "role-grants-unknown");
    expect(code).toBeDefined();
    expect(code?.message).toContain("phantom:perm");
  });

  it("emits api-no-declared-perm for API routes with empty declaredPermissions", () => {
    const catalog = minimalCatalog({
      apiRoutes: [{ path: "/api/health", file: "src/app/api/health/route.ts", methods: ["GET"], declaredPermissions: [] }],
    });
    const { drifts } = buildUsage([], catalog, [], makeRoleMap([]));
    const code = drifts.find((d) => d.code === "api-no-declared-perm");
    expect(code).toBeDefined();
    expect(code?.message).toContain("/api/health");
  });

  it("emits api-decl-perm-unused when declared but no requirePermission call", () => {
    const catalog = minimalCatalog({
      apiRoutes: [
        {
          path: "/api/admin/users",
          file: "src/app/api/admin/users/route.ts",
          methods: ["POST"],
          declaredPermissions: ["user:manage"],
        },
      ],
    });
    const { drifts } = buildUsage([], catalog, ["user:manage"], makeRoleMap(["user:manage"]));
    const code = drifts.find((d) => d.code === "api-decl-perm-unused");
    expect(code).toBeDefined();
    expect(code?.message).toContain("user:manage");
  });

  it("does not emit api-decl-perm-unused when requirePermission is called in the route", () => {
    const catalog = minimalCatalog({
      apiRoutes: [
        {
          path: "/api/admin/users",
          file: "src/app/api/admin/users/route.ts",
          methods: ["POST"],
          declaredPermissions: ["user:manage"],
        },
      ],
    });
    const callSites: CallSite[] = [
      {
        permission: "user:manage",
        kind: "requirePermission",
        file: "src/app/api/admin/users/route.ts",
        line: 5,
      },
    ];
    const { drifts } = buildUsage(callSites, catalog, ["user:manage"], makeRoleMap(["user:manage"]));
    expect(drifts.find((d) => d.code === "api-decl-perm-unused")).toBeUndefined();
  });

  it("emits page-button-perm-unused when a canX variable is set but never referenced", () => {
    let tmp: string | null = null;
    try {
      tmp = mkdtempSync(join(tmpdir(), "rbac-audit-"));
      const file = join(tmp, "page.tsx");
      writeFileSync(
        file,
        [
          "export default function Page() {",
          "  const canDelete = sessionHasPermission(session, \"server:write\");",
          "  return <div>not referencing the gating variable here</div>;",
          "}",
        ].join("\n"),
      );
      const callSites: CallSite[] = [
        {
          permission: "server:write",
          kind: "sessionHasPermission",
          file,
          line: 2,
          variable: "canDelete",
        },
      ];
      const { drifts } = buildUsage(callSites, minimalCatalog(), ["server:write"], makeRoleMap(["server:write"]));
      const code = drifts.find((d) => d.code === "page-button-perm-unused");
      expect(code).toBeDefined();
      expect(code?.message).toContain("canDelete");
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not emit page-button-perm-unused when the canX variable is referenced elsewhere", () => {
    let tmp: string | null = null;
    try {
      tmp = mkdtempSync(join(tmpdir(), "rbac-audit-"));
      const file = join(tmp, "page.tsx");
      writeFileSync(
        file,
        [
          "export default function Page() {",
          "  const canDelete = sessionHasPermission(session, \"server:write\");",
          "  return <div>{canDelete ? 'yes' : 'no'}</div>;",
          "}",
        ].join("\n"),
      );
      const callSites: CallSite[] = [
        {
          permission: "server:write",
          kind: "sessionHasPermission",
          file,
          line: 2,
          variable: "canDelete",
        },
      ];
      const { drifts } = buildUsage(callSites, minimalCatalog(), ["server:write"], makeRoleMap(["server:write"]));
      expect(drifts.find((d) => d.code === "page-button-perm-unused")).toBeUndefined();
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns an empty drifts list when no drift is present", () => {
    const catalog = minimalCatalog();
    // (the canRead variable must be referenced somewhere outside the
    // assignment line, otherwise buildUsage would emit
    // page-button-perm-unused. We write a real file that references
    // the variable in JSX, so the page-button-perm-unused check
    // stays zero.)
    let tmp: string | null = null;
    try {
      tmp = mkdtempSync(join(tmpdir(), "rbac-audit-"));
      const file = join(tmp, "page.tsx");
      writeFileSync(
        file,
        [
          "export default function Page() {",
          "  const canRead = sessionHasPermission(session, \"audit:read\");",
          "  return <div>{canRead}</div>;",
          "}",
        ].join("\n"),
      );
      const validSites: CallSite[] = [
        {
          permission: "audit:read",
          kind: "sessionHasPermission",
          file,
          line: 2,
          variable: "canRead",
        },
      ];
      const { drifts } = buildUsage(validSites, catalog, ["audit:read"], makeRoleMap(["audit:read"]));
      // api-no-declared-perm: 0 (catalog is empty)
      // perm-without-role: 0 (admin has audit:read)
      expect(drifts).toHaveLength(0);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ─── buildMarkdown — format ────────────────────────────────────────────────

describe("buildMarkdown — report format", () => {
  it("includes the summary header with permission/role/route/page counts", () => {
    const md = buildMarkdown(
      makeReport({
        summary: {
          permissionsInList: 39,
          rolesDefined: 4,
          apiRoutesAudited: 79,
          pagesAudited: 39,
          callSitesAudited: 100,
          driftCount: 0,
          driftByCode: {
            "perm-not-in-list": 0,
            "perm-without-role": 0,
            "role-grants-unknown": 0,
            "api-no-declared-perm": 0,
            "api-decl-perm-unused": 0,
            "api-route-missing": 0,
            "page-button-perm-unused": 0,
          },
        },
      }),
    );
    expect(md).toMatch(/^# VControlHub RBAC Audit Report/);
    expect(md).toMatch(/Permissions: 39 \| Roles: 4 \| API routes: 79 \| Pages: 39 \| Drift: 0/);
  });

  it("emits a 'No drift detected' line when the report has zero drifts", () => {
    const md = buildMarkdown(makeReport());
    expect(md).toContain("## ✅ No drift detected");
  });

  it("emits a drift details section with the message and JSON context when drifts exist", () => {
    const drift: Drift = {
      code: "api-no-declared-perm",
      severity: "low",
      message: `API route /api/foo has no declaredPermissions`,
      context: { path: "/api/foo", file: "src/app/api/foo/route.ts", methods: ["GET"] },
    };
    const md = buildMarkdown(makeReport({ drifts: [drift] }));
    expect(md).toContain("## Drift details");
    expect(md).toContain("`api-no-declared-perm` (low)");
    expect(md).toContain("API route /api/foo has no declaredPermissions");
    expect(md).toContain("```json");
    expect(md).toContain('"path": "/api/foo"');
  });
});
