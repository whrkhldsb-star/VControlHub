// @vitest-environment node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The RBAC audit is a gate: run against a fixture repository whose only API
 * route declares a permission it never enforces, it must exit non-zero; the
 * same route enforcing the permission passes. Uses the real rbac.ts.
 */
const repo = path.resolve(".");
const tsx = path.join(repo, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

function writeFixtureRoute(root: string, body: string) {
  const dir = path.join(root, "src", "app", "api", "fixture");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "route.ts"), body);
}

describe.skipIf(!existsSync(tsx))("rbac:audit gate", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "vch-rbac-gate-"));
    mkdirSync(path.join(root, "src", "lib", "auth"), { recursive: true });
    mkdirSync(path.join(root, "src", "components"), { recursive: true });
    mkdirSync(path.join(root, "docs"));
    copyFileSync(path.join(repo, "src", "lib", "auth", "rbac.ts"), path.join(root, "src", "lib", "auth", "rbac.ts"));
    writeFileSync(path.join(root, "docs", "route-catalog.json"), JSON.stringify({
      generatedAt: "2026-10-12T00:00:00.000Z",
      summary: { pages: 0, apiRoutes: 1, permissionsDefined: 0 },
      sidebar: [],
      pages: [],
      apiRoutes: [{ path: "/api/fixture", file: "src/app/api/fixture/route.ts", methods: ["GET"], guardMode: "withApiRoute", declaredPermissions: ["server:read"] }],
      permissions: [],
    }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const run = (...args: string[]) =>
    spawnSync(tsx, [path.join(repo, "scripts", "rbac-audit.ts"), "--no-write", ...args], { cwd: root, encoding: "utf8" });

  it("fails on a route that declares a permission it does not enforce", () => {
    writeFixtureRoute(root, "export async function GET() { return new Response('open to everyone'); }\n");
    const result = run();
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stderr).toMatch(/api-decl-perm-unused/);
    expect(existsSync(path.join(root, "docs", "rbac-audit.json"))).toBe(false);
  });

  it("passes when the route enforces its declared permission", () => {
    writeFixtureRoute(root, 'export async function GET(request: Request) { return withApiRoute(request, { permission: "server:read" }, async () => new Response("ok")); }\n');
    const result = run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("keeps the informational mode available behind --report-only", () => {
    writeFixtureRoute(root, "export async function GET() { return new Response('open'); }\n");
    expect(run("--report-only").status).toBe(0);
  });
});
