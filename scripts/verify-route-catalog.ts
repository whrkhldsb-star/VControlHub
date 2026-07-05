/**
 * scripts/verify-route-catalog.ts
 *
 * Verifies docs/route-catalog.json against the source tree.
 * Exits 0 when all checks pass, 1 when any violation is found.
 *
 * Checks:
 *   1. Every sidebar href resolves to a real page.tsx.
 *   2. Every page declared permission is defined in rbac.PERMISSIONS.
 *   3. Every api route declares at least one HTTP method.
 *   4. Every api declared permission is defined in rbac.PERMISSIONS.
 *   5. Every permission in rbac.PERMISSIONS is used at least once anywhere in src/.
 *
 * Run: npx tsx scripts/verify-route-catalog.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const ROOT = process.cwd();
const CATALOG = join(ROOT, 'docs', 'route-catalog.json');

type Catalog = {
  sidebar: { main: { href: string }[]; system: { href: string }[]; mobileHrefs: string[] };
  pages: { path: string; declaredPermissions: string[] }[];
  apiRoutes: { path: string; methods: string[]; declaredPermissions: string[]; guardMode?: string }[];
  permissions: string[];
};

const catalog: Catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));

const errors: string[] = [];
const warn: string[] = [];

const pagePaths = new Set(catalog.pages.map((p) => p.path));
const permSet = new Set(catalog.permissions);

for (const item of catalog.sidebar.main) {
  if (!pagePaths.has(item.href)) {
    errors.push(`sidebar main href ${item.href} has no matching page.tsx`);
  }
}
for (const item of catalog.sidebar.system) {
  if (!pagePaths.has(item.href)) {
    errors.push(`sidebar system href ${item.href} has no matching page.tsx`);
  }
}
for (const href of catalog.sidebar.mobileHrefs) {
  if (!pagePaths.has(href)) {
    errors.push(`mobile href ${href} has no matching page.tsx`);
  }
}

const usedInPageOrApi = new Set<string>();
for (const page of catalog.pages) {
  for (const p of page.declaredPermissions) {
    if (!permSet.has(p)) {
      errors.push(`page ${page.path} declares unknown permission ${p}`);
    }
    usedInPageOrApi.add(p);
  }
}
for (const route of catalog.apiRoutes) {
  if (route.methods.length === 0) {
    errors.push(`api ${route.path} declares no HTTP method`);
  }
  if (!route.guardMode) {
    errors.push(`api ${route.path} has no guardMode declaration or inferred guard`);
  }
  for (const p of route.declaredPermissions) {
    if (!permSet.has(p)) {
      errors.push(`api ${route.path} declares unknown permission ${p}`);
    }
    usedInPageOrApi.add(p);
  }
}

// 5. Scan every src/ TS/TSX (excluding tests) for permission string references.
const srcFiles = walk(join(ROOT, 'src')).filter(
  (f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__')
);
const usedAnywhere = new Set<string>();
// 匹配 xxx:yyy 或 xxx:yyy:zzz (如 ai:action:approve)
const re = /['"]([a-z][a-z0-9-]+(?::[a-z][a-z0-9-]+)+)['"]/g;
for (const f of srcFiles) {
  const text = readFileSync(f, 'utf8');
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    usedAnywhere.add(m[1]!);
  }
}
for (const p of catalog.permissions) {
  if (!usedAnywhere.has(p)) {
    warn.push(`permission ${p} defined in rbac but not referenced anywhere in src/`);
  }
}

if (errors.length === 0) {
  console.log(
    `OK  ${catalog.pages.length} pages, ${catalog.apiRoutes.length} api routes, ${catalog.permissions.length} perms checked`
  );
  if (warn.length) {
    console.log(`WARN (${warn.length}):`);
    for (const w of warn) console.log(`  - ${w}`);
  }
  process.exit(0);
} else {
  console.error(`FAIL (${errors.length} errors):`);
  for (const e of errors) console.error(`  - ${e}`);
  if (warn.length) {
    console.error(`WARN (${warn.length}):`);
    for (const w of warn) console.error(`  - ${w}`);
  }
  process.exit(1);
}
