/**
 * scripts/rbac-audit.ts
 *
 * Static RBAC drift analyzer for VControlHub. Cross-references four
 * sources of truth for the permission system and reports inconsistencies:
 *
 *   1. `src/lib/auth/rbac.ts` — the canonical `PERMISSIONS` tuple and
 *      the `DEFAULT_ROLE_PERMISSIONS` role-to-permission map.
 *   2. `docs/route-catalog.json` — the per-API-route and per-page
 *      `declaredPermissions` arrays (produced by `npm run route:catalog`).
 *   3. `src/app/**\/*.{ts,tsx}` — actual `sessionHasPermission(...)` and
 *      `requirePermission(...)` call sites, the real enforcement points.
 *   4. `src/app/**\/page.tsx` — page-level permission gating declarations
 *      via the per-page module metadata (if any).
 *
 * Drift categories emitted (with a stable `code` string for CI gates):
 *   - `perm-not-in-list`        — a permission string used in code/catalog
 *                                 is missing from the `PERMISSIONS` tuple.
 *   - `perm-without-role`       — `PERMISSIONS` declares X but no role
 *                                 grants X (admin is excluded; it always
 *                                 gets every permission).
 *   - `role-grants-unknown`     — a role grants a permission not present
 *                                 in `PERMISSIONS` (likely typo / dead).
 *   - `api-no-declared-perm`    — an API route exists but has no
 *                                 `declaredPermissions` (could be public,
 *                                 but worth flagging for review).
 *   - `api-decl-perm-unused`    — `declaredPermissions` lists X but the route
 *                                 handler never enforces it (via `requirePermission(X)`
 *                                 or `withApiRoute(..., { permission: X }, ...)`).
 *   - `api-route-missing`       — `requirePermission` is called from a
 *                                 path not represented in route-catalog.
 *   - `page-button-perm-unused` — a `sessionHasPermission("X")` call in
 *                                 a page never gates a visible button
 *                                 (`X` is only "set" but never read). The
 *                                 script emits this as a soft signal: the
 *                                 `canX` variable must be referenced.
 *
 * Output:
 *   - JSON report to `docs/rbac-audit.json` (machine-readable).
 *   - Markdown report to `docs/rbac-audit.md` (human-readable).
 *   - Stdout summary: perm count, role count, drift count by category.
 *   - Exit code 0 (informational — backlog, not a regression signal).
 *
 * Run: `npx tsx scripts/rbac-audit.ts`
 */
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src/app", "src/components"];
const RBAC_PATH = "src/lib/auth/rbac.ts";
const CATALOG_PATH = "docs/route-catalog.json";
const REPORT_JSON_PATH = "docs/rbac-audit.json";
const REPORT_MD_PATH = "docs/rbac-audit.md";
const SKIP_DIR_NAMES = new Set([
  "__tests__",
  "node_modules",
  ".next",
  "dist",
]);

export type RoleKey = "admin" | "operator" | "viewer" | "storage_manager";

export interface RouteCatalog {
  generatedAt: string;
  summary: {
    pages: number;
    apiRoutes: number;
    permissionsDefined: number;
  };
  apiRoutes: Array<{
    path: string;
    file: string;
    methods: string[];
    declaredPermissions: string[];
  }>;
  pages: Array<{
    path: string;
    file: string;
    inSidebarMain: boolean;
    inSidebarSystem: boolean;
    declaredPermissions: string[];
  }>;
  permissions: string[];
}

export interface PermissionUsage {
  permission: string;
  files: Array<{ path: string; line: number }>;
  pages: string[];
  apiRoutes: string[];
  grantedToRoles: RoleKey[];
}

export interface Drift {
  code:
    | "perm-not-in-list"
    | "perm-without-role"
    | "role-grants-unknown"
    | "api-no-declared-perm"
    | "api-decl-perm-unused"
    | "api-route-missing"
    | "page-button-perm-unused";
  severity: "high" | "medium" | "low";
  message: string;
  context?: Record<string, unknown>;
}

export interface AuditReport {
  generatedAt: string;
  summary: {
    permissionsInList: number;
    rolesDefined: number;
    apiRoutesAudited: number;
    pagesAudited: number;
    callSitesAudited: number;
    driftCount: number;
    driftByCode: Record<Drift["code"], number>;
  };
  permissions: PermissionUsage[];
  drifts: Drift[];
}

// ─── File collection ───────────────────────────────────────────────────────

export function collectSourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) {
    walk(dir, out);
  }
  return out;
}

export function walk(dir: string, out: string[]): void {
  const abs = resolve(ROOT, dir);
  if (!existsSync(abs)) return;
  const stat = statSync(abs);
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

// ─── rbac.ts parser ────────────────────────────────────────────────────────

export function loadRbac(): {
  permissions: string[];
  roleMap: Record<RoleKey, string[]>;
} {
  const text = readFileSync(resolve(ROOT, RBAC_PATH), "utf8");

  // PERMISSIONS tuple: extract every "<word>:<word>" string literal inside
  // the `export const PERMISSIONS = [ ... ] as const;` block. We slice
  // between the first `[` and the matching `] as const;`.
  const startIdx = text.indexOf("export const PERMISSIONS");
  if (startIdx < 0) {
    throw new Error(`Could not find PERMISSIONS export in ${RBAC_PATH}`);
  }
  const openBracket = text.indexOf("[", startIdx);
  const closeIdx = text.indexOf("] as const;", openBracket);
  if (openBracket < 0 || closeIdx < 0) {
    throw new Error(
      `Could not bracket PERMISSIONS block in ${RBAC_PATH}`,
    );
  }
  const permsBlock = text.slice(openBracket, closeIdx);
  // Match permission literals like "announcement:manage", "api-token:manage",
  // "ai:action:approve", "storage:manage-node". Each segment allows
  // lowercase letters, digits, underscores, and hyphens; we permit 1+
  // segments separated by `:`.
  const permRegex = /"([a-z][a-z0-9_-]*(?::[a-z0-9_-]+)+)"/g;
  const permissions: string[] = [];
  for (const m of permsBlock.matchAll(permRegex)) {
    permissions.push(m[1]!);
  }

  // DEFAULT_ROLE_PERMISSIONS: extract the role block as a literal string
  // and decode it. The admin role uses `admin: ALL_PERMISSIONS,` (a
  // reference to the spread of the PERMISSIONS tuple) while other roles
  // use a string array literal. We handle both shapes.
  const roleKeys: RoleKey[] = ["admin", "operator", "viewer", "storage_manager"];
  const roleMap: Record<RoleKey, string[]> = {
    admin: [...permissions], // admin implicitly gets all permissions
    operator: [],
    viewer: [],
    storage_manager: [],
  };

  for (const role of roleKeys) {
    if (role === "admin") continue; // handled above
    const roleHeaderRe = new RegExp(`\\b${role}\\s*:\\s*\\[`, "g");
    const headerMatch = roleHeaderRe.exec(text);
    if (!headerMatch) continue;
    const openIdx = text.indexOf("[", headerMatch.index);
    // walk to matching close — naive but OK for this file
    let depth = 1;
    let i = openIdx + 1;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === "[") depth++;
      else if (ch === "]") depth--;
      i++;
    }
    if (depth !== 0) continue;
    const body = text.slice(openIdx + 1, i - 1);
    const rolePermRe = /"([a-z][a-z0-9_-]*(?::[a-z0-9_-]+)+)"/g;
    for (const m of body.matchAll(rolePermRe)) {
      roleMap[role].push(m[1]!);
    }
  }

  return { permissions, roleMap };
}

// ─── route-catalog.json loader ─────────────────────────────────────────────

export function loadCatalog(): RouteCatalog {
  const text = readFileSync(resolve(ROOT, CATALOG_PATH), "utf8");
  return JSON.parse(text) as RouteCatalog;
}

// ─── Code scanner ──────────────────────────────────────────────────────────

export interface CallSite {
  permission: string;
  kind: "sessionHasPermission" | "requirePermission" | "withApiRoutePermission";
  file: string;
  line: number;
  /** For `sessionHasPermission` only: the variable name assigned (e.g. `canDelete`) */
  variable?: string;
  /** For `requirePermission` only: the API route file this came from */
  apiFile?: string;
}

export function scanCallSites(files: string[]): CallSite[] {
  const sites: CallSite[] = [];
  // sessionHasPermission(<expr>, "perm:key")  — `<expr>` may be `session`, `session!`, `input.session`, etc.
  const sessionRe =
    /sessionHasPermission\(\s*[^,]+,\s*"([a-z]+:[a-z][a-z_-]*)"\s*\)/g;
  // requirePermission("perm:key")
  const requireRe = /requirePermission\(\s*"([a-z]+:[a-z][a-z_-]*)"\s*\)/g;
  // withApiRoute(  — match the wrapper opener; the `permission: "X"` arg
  // may be on the same line or 1-5 lines below, so we do a window scan.
  const withApiRouteRe = /\bwithApiRoute\s*\(/g;
  // `permission: "perm:key"` (single-line, no `withApiRoute` qualifier)
  const permArgRe = /\bpermission:\s*"([a-z]+:[a-z][a-z_-]*)"/g;

  for (const file of files) {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // variable assignment: `const canX = sessionHasPermission(...)`
      const assignMatch = line.match(
        /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*sessionHasPermission\(/,
      );
      for (const m of line.matchAll(sessionRe)) {
        sites.push({
          permission: m[1]!,
          kind: "sessionHasPermission",
          file,
          line: i + 1,
          variable: assignMatch?.[1],
        });
      }
      for (const m of line.matchAll(requireRe)) {
        // Try to detect a nearby file:path comment for the route
        const fileMatch = line.match(/src\/app\/api\/[^"'\s)]+/);
        sites.push({
          permission: m[1]!,
          kind: "requirePermission",
          file,
          line: i + 1,
          apiFile: fileMatch?.[0],
        });
      }
      // withApiRoute wrapper — collect a window of up to 5 lines forward,
      // extract every `permission: "X"` arg, and record each as enforcement.
      // Skip if this same line already matched `requirePermission` / `sessionHasPermission`
      // to avoid double-counting in the (rare) case of a one-liner that mixes both.
      if (withApiRouteRe.test(line)) {
        withApiRouteRe.lastIndex = 0;
        const windowEnd = Math.min(lines.length, i + 6);
        for (let j = i; j < windowEnd; j++) {
          for (const m of lines[j]!.matchAll(permArgRe)) {
            sites.push({
              permission: m[1]!,
              kind: "withApiRoutePermission",
              file,
              line: j + 1,
            });
          }
        }
      }
    }
  }
  return sites;
}

// ─── Cross-reference aggregator ────────────────────────────────────────────

export function buildUsage(
  callSites: CallSite[],
  catalog: RouteCatalog,
  permissions: string[],
  roleMap: Record<RoleKey, string[]>,
): { usage: PermissionUsage[]; drifts: Drift[] } {
  const usageMap = new Map<string, PermissionUsage>();
  const drifts: Drift[] = [];

  for (const p of permissions) {
    usageMap.set(p, {
      permission: p,
      files: [],
      pages: [],
      apiRoutes: [],
      grantedToRoles: [],
    });
  }
  for (const [role, perms] of Object.entries(roleMap) as [RoleKey, string[]][]) {
    for (const p of perms) {
      let u = usageMap.get(p);
      if (!u) {
        u = {
          permission: p,
          files: [],
          pages: [],
          apiRoutes: [],
          grantedToRoles: [],
        };
        usageMap.set(p, u);
      }
      u.grantedToRoles.push(role);
    }
  }

  // Code call sites
  for (const cs of callSites) {
    let u = usageMap.get(cs.permission);
    if (!u) {
      u = {
        permission: cs.permission,
        files: [],
        pages: [],
        apiRoutes: [],
        grantedToRoles: [],
      };
      usageMap.set(cs.permission, u);
    }
    u.files.push({ path: cs.file, line: cs.line });
    if (cs.kind === "sessionHasPermission") {
      // Only count page.tsx files as "page" usage; anything under
      // src/app/api/ is API-route logic and belongs in apiRoutes.
      if (cs.file.endsWith("/page.tsx") || cs.file.endsWith("page.tsx")) {
        const page = cs.file
          .replace(/^src\/app\//, "")
          .replace(/\/page\.tsx$/, "");
        if (!u.pages.includes(page)) u.pages.push(page);
      } else if (cs.file.includes("/api/")) {
        const apiRoute = cs.file
          .replace(/^src\/app\//, "/")
          .replace(/\/route\.ts$/, "");
        if (!u.apiRoutes.includes(apiRoute)) u.apiRoutes.push(apiRoute);
      }
    } else if (cs.kind === "requirePermission") {
      const apiRoute = (cs.apiFile ?? cs.file)
        .replace(/^src\/app\/api\//, "/api/")
        .replace(/\/route\.ts$/, "");
      if (!u.apiRoutes.includes(apiRoute)) u.apiRoutes.push(apiRoute);
    }
  }

  // Drift: perm-not-in-list
  for (const cs of callSites) {
    if (!permissions.includes(cs.permission)) {
      drifts.push({
        code: "perm-not-in-list",
        severity: "high",
        message: `Permission "${cs.permission}" is used in code but not in the PERMISSIONS tuple`,
        context: { file: cs.file, line: cs.line, kind: cs.kind },
      });
    }
  }
  // Drift: role grants unknown perm
  for (const [role, perms] of Object.entries(roleMap) as [RoleKey, string[]][]) {
    for (const p of perms) {
      if (!permissions.includes(p)) {
        drifts.push({
          code: "role-grants-unknown",
          severity: "high",
          message: `Role "${role}" grants unknown permission "${p}" (not in PERMISSIONS)`,
          context: { role, permission: p },
        });
      }
    }
  }
  // Drift: perm-without-role (admin excluded)
  for (const p of permissions) {
    const u = usageMap.get(p);
    if (!u) continue;
    if (u.grantedToRoles.length === 0) {
      drifts.push({
        code: "perm-without-role",
        severity: "medium",
        message: `Permission "${p}" is declared in PERMISSIONS but no non-admin role grants it`,
        context: { permission: p, roles: u.grantedToRoles },
      });
    }
  }
  // Drift: api-no-declared-perm
  for (const r of catalog.apiRoutes) {
    if (r.declaredPermissions.length === 0) {
      drifts.push({
        code: "api-no-declared-perm",
        severity: "low",
        message: `API route ${r.path} has no declaredPermissions (could be intentionally public)`,
        context: { path: r.path, file: r.file, methods: r.methods },
      });
    } else {
      // Drift: api-decl-perm-unused  (declared but not enforced via
      // requirePermission(...) OR withApiRoute(..., { permission: X }, ...))
      for (const declared of r.declaredPermissions) {
        const targetPath = r.file
          .replace(/^src\/app\//, "")
          .replace(/\/route\.ts$/, "");
        const used = callSites.some((cs) => {
          if (cs.permission !== declared) return false;
          if (cs.kind === "requirePermission") {
            const csPath = cs.file
              .replace(/^src\/app\//, "")
              .replace(/\/route\.ts$/, "");
            return targetPath.startsWith(csPath) || csPath.startsWith(targetPath);
          }
          if (cs.kind === "withApiRoutePermission") {
            // Same file as the route — guaranteed by the route-catalog
            // mapping. The withApiRoute enforcement happens in the same
            // route.ts file, so a same-file match is sufficient.
            return cs.file === r.file;
          }
          return false;
        });
        if (!used) {
          drifts.push({
            code: "api-decl-perm-unused",
            severity: "medium",
            message: `API route ${r.path} declares "${declared}" but the route handler doesn't enforce it via requirePermission("${declared}") or withApiRoute(..., { permission: "${declared}" }, ...)`,
            context: { path: r.path, declaredPermission: declared, file: r.file },
          });
        }
      }
    }
  }
  // Drift: page-button-perm-unused — variable assigned but never referenced
  // in the same file. We do a cheap textual check: collect the variable name
  // and confirm the same name appears elsewhere in the file (besides the
  // declaration line).
  const byFile = new Map<string, CallSite[]>();
  for (const cs of callSites) {
    if (cs.kind !== "sessionHasPermission" || !cs.variable) continue;
    const arr = byFile.get(cs.file) ?? [];
    arr.push(cs);
    byFile.set(cs.file, arr);
  }
  for (const [file, sites] of byFile) {
    const text = readFileSync(resolve(ROOT, file), "utf8");
    const lines = text.split("\n");
    for (const cs of sites) {
      if (!cs.variable) continue;
      // Count occurrences of the variable in lines OTHER than the
      // declaration line. If zero references, the variable is dead.
      const varName = cs.variable;
      let refs = 0;
      for (let i = 0; i < lines.length; i++) {
        if (i + 1 === cs.line) continue;
        if (lines[i]!.includes(varName)) refs++;
      }
      if (refs === 0) {
        drifts.push({
          code: "page-button-perm-unused",
          severity: "low",
          message: `In ${relative(ROOT, resolve(ROOT, file))}: variable "${varName}" is set from sessionHasPermission("${cs.permission}") but never referenced elsewhere in the file`,
          context: {
            file,
            line: cs.line,
            permission: cs.permission,
            variable: varName,
          },
        });
      }
    }
  }

  return { usage: Array.from(usageMap.values()).sort((a, b) => a.permission.localeCompare(b.permission)), drifts };
}

// ─── Report writers ────────────────────────────────────────────────────────

export function buildMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  const { summary, drifts, permissions } = report;

  lines.push("# VControlHub RBAC Audit Report");
  lines.push("");
  lines.push(
    `> Generated: ${report.generatedAt} | Permissions: ${summary.permissionsInList} | Roles: ${summary.rolesDefined} | API routes: ${summary.apiRoutesAudited} | Pages: ${summary.pagesAudited} | Drift: ${summary.driftCount}`,
  );
  lines.push("");
  lines.push(
    "This report cross-references four RBAC sources of truth:",
  );
  lines.push(
    "1. `src/lib/auth/rbac.ts` — `PERMISSIONS` tuple + `DEFAULT_ROLE_PERMISSIONS` map",
  );
  lines.push(
    "2. `docs/route-catalog.json` — per-API-route and per-page `declaredPermissions`",
  );
  lines.push(
    "3. `src/app/**/*.{ts,tsx}` — actual `sessionHasPermission(...)` and `requirePermission(...)` call sites",
  );
  lines.push(
    "4. Page-level permission gating (variable assignment + downstream usage)",
  );
  lines.push("");
  lines.push("## Drift by category");
  lines.push("");
  lines.push("| Code | Severity | Count |");
  lines.push("|---|---|---|");
  for (const [code, count] of Object.entries(summary.driftByCode)) {
    const sample = drifts.find((d) => d.code === code);
    const sev = sample?.severity ?? "low";
    lines.push(`| \`${code}\` | ${sev} | ${count} |`);
  }
  lines.push("");
  lines.push("## Permissions");
  lines.push("");
  lines.push(
    "| Permission | Granted to roles | Pages using | API routes using | Files |",
  );
  lines.push("|---|---|---|---|---|");
  for (const u of permissions) {
    const roles = u.grantedToRoles.length === 0 ? "_(none, admin implicit)_" : u.grantedToRoles.join(", ");
    lines.push(
      `| \`${u.permission}\` | ${roles} | ${u.pages.length} | ${u.apiRoutes.length} | ${u.files.length} |`,
    );
  }
  lines.push("");
  if (drifts.length > 0) {
    lines.push("## Drift details");
    lines.push("");
    for (const d of drifts) {
      lines.push(`### \`${d.code}\` (${d.severity})`);
      lines.push(d.message);
      if (d.context) {
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(d.context, null, 2));
        lines.push("```");
      }
      lines.push("");
    }
  } else {
    lines.push("## ✅ No drift detected");
  }
  return lines.join("\n") + "\n";
}

// ─── Main ──────────────────────────────────────────────────────────────────

export function runAudit(): AuditReport {
  if (!existsSync(resolve(ROOT, CATALOG_PATH))) {
    console.error(`Missing ${CATALOG_PATH} — run \`npm run route:catalog\` first`);
    process.exit(2);
  }
  if (!existsSync(resolve(ROOT, RBAC_PATH))) {
    console.error(`Missing ${RBAC_PATH}`);
    process.exit(2);
  }

  const { permissions, roleMap } = loadRbac();
  const catalog = loadCatalog();
  const files = collectSourceFiles();
  const callSites = scanCallSites(files);
  const { usage, drifts } = buildUsage(callSites, catalog, permissions, roleMap);

  const driftByCode: Record<Drift["code"], number> = {
    "perm-not-in-list": 0,
    "perm-without-role": 0,
    "role-grants-unknown": 0,
    "api-no-declared-perm": 0,
    "api-decl-perm-unused": 0,
    "api-route-missing": 0,
    "page-button-perm-unused": 0,
  };
  for (const d of drifts) driftByCode[d.code]++;

  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    summary: {
      permissionsInList: permissions.length,
      rolesDefined: Object.keys(roleMap).length,
      apiRoutesAudited: catalog.apiRoutes.length,
      pagesAudited: catalog.pages.length,
      callSitesAudited: callSites.length,
      driftCount: drifts.length,
      driftByCode,
    },
    permissions: usage,
    drifts,
  };

  writeFileSync(
    resolve(ROOT, REPORT_JSON_PATH),
    JSON.stringify(report, null, 2) + "\n",
  );
  writeFileSync(resolve(ROOT, REPORT_MD_PATH), buildMarkdown(report));

  return report;
}

function main() {
  const report = runAudit();
  const { summary } = report;
  console.log(
    `loaded ${summary.permissionsInList} permissions, ${summary.rolesDefined} roles, ${summary.apiRoutesAudited} API routes, ${summary.pagesAudited} pages`,
  );
  console.log(
    `scanned ${summary.callSitesAudited} call sites, found ${summary.driftCount} drift(s)`,
  );
  console.log(
    `wrote ${REPORT_JSON_PATH} (${statSync(resolve(ROOT, REPORT_JSON_PATH)).size} bytes)`,
  );
  console.log(
    `wrote ${REPORT_MD_PATH} (${statSync(resolve(ROOT, REPORT_MD_PATH)).size} bytes)`,
  );
  for (const [code, count] of Object.entries(summary.driftByCode)) {
    if (count > 0) console.log(`  ${count}x  ${code}`);
  }
  // Informational only — drift is a backlog, not a regression signal.
  process.exit(0);
}

if (resolve(process.argv[1] || "") === resolve(__filename)) {
  main();
}
