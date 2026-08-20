/**
 * scripts/build-route-catalog.ts
 *
 * Generates docs/route-catalog.json from real source files so the catalog
 * stays the single source of truth for "sidebar → route → permission → API".
 *
 * Run: npx tsx scripts/build-route-catalog.ts
 */
import { existsSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import {
  mainNavItems,
  mobileNavItems,
  systemNavItems,
} from '../src/components/nav-items';

const ROOT = process.cwd();
const APP = join(ROOT, 'src', 'app');
const RBAC_FILE = join(ROOT, 'src', 'lib', 'auth', 'rbac.ts');
const OUT = join(ROOT, 'docs', 'route-catalog.json');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Build a Set of every permission key declared in src/lib/auth/rbac.ts.
 * Treating the RBAC PERMISSIONS list as the authoritative dictionary lets us
 * match permission references in pages/routes by exact membership instead of
 * guessing a suffix list (TR-043: previous regex missed `backup:restore`,
 * `command:execute`, `server:ssh`, `deploy:run`, `deploy:export`,
 * `ai:action:approve`, etc.).
 */
function loadPermissionVocabulary(): Set<string> {
  const text = readFileSync(RBAC_FILE, 'utf8');
  const match = text.match(/export const PERMISSIONS\s*=\s*\[([\s\S]*?)\];/);
  const set = new Set<string>();
  if (!match) return set;
  for (const m of match[1]!.matchAll(/"([^"]+)"/g)) {
    set.add(m[1]!);
  }
  return set;
}

const PERMISSION_VOCAB = loadPermissionVocabulary();

function declaredPerms(text: string): string[] {
  // Match any single- or double-quoted string and keep only those that appear
  // in the PERMISSIONS dictionary. Conservative: ignores everything that is
  // not an exact RBAC permission, so noise like file paths or i18n keys cannot
  // pollute the catalog.
  const re = /['"]([a-z][a-z0-9_-]*(?::[a-z0-9_-]+)+)['"]/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const candidate = m[1]!;
    if (PERMISSION_VOCAB.has(candidate)) {
      set.add(candidate);
    }
  }
  return [...set].sort();
}

/**
 * Page chrome needs the permission that admits a user to the route, rather
 * than every permission mentioned by optional controls inside that page.
 * For example, `/files` requires `storage:read`, while its upload/delete
 * buttons also mention write-only permissions.  Falling back to the complete
 * declaration preserves the prior discoverability behavior for pages that
 * intentionally use a bare session guard and show partial capabilities.
 */
function navigationPerms(text: string, fallback: string[]): string[] {
  const set = new Set<string>();
  const re = /requirePagePermission\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const candidate = m[1]!;
    if (PERMISSION_VOCAB.has(candidate)) set.add(candidate);
  }
  return set.size > 0 ? [...set].sort() : fallback;
}

function pagePathFor(fileAbs: string): string {
  const rel = relative(APP, fileAbs);
  if (rel === 'page.tsx') return '/';
  return '/' + rel.slice(0, -'/page.tsx'.length);
}

function apiMethods(text: string, filePath: string, seen: Set<string> = new Set()): string[] {
  if (seen.has(filePath)) return [];
  seen.add(filePath);
  const set = new Set<string>();
  const direct = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  let m: RegExpExecArray | null;
  while ((m = direct.exec(text)) !== null) {
    set.add(m[1]!);
  }
  // Next.js route handlers may also export a shared handler by alias, e.g.
  // `export const GET = withParams`. Treat those as first-class methods too.
  const aliases = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/g;
  while ((m = aliases.exec(text)) !== null) {
    set.add(m[1]!);
  }
  // 跟随 re-export: `export { GET } from "./other";`
  const reexp = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  while ((m = reexp.exec(text)) !== null) {
    const names = m[1]!
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('type '))
      .map((s) => s.split(/\s+as\s+/).pop()!);
    const targetRel = m[2]!;
    const targetDir = dirname(filePath);
    const target = resolve(targetDir, targetRel) + (targetRel.endsWith('.ts') ? '' : '.ts');
    try {
      const t = readFileSync(target, 'utf8');
      for (const n of apiMethods(t, target, seen)) {
        if (names.includes(n)) set.add(n);
      }
    } catch {
      // ignore missing target
    }
  }
  return [...set].sort();
}

function guardMode(text: string): string {
  const match = text.match(/(?:export\s+const\s+guardMode\s*=\s*["']([^"']+)["']|guardMode:\s*([a-zA-Z-]+))/);
  if (match) return match[1] ?? match[2]!;
  if (text.includes('withApiRoute(')) return 'withApiRoute';
  if (text.includes('enforceApiGuard(') || text.includes('requireApiPermission(')) return 'manual';
  if (text.includes('verifyBearerToken(')) return 'bearer';
  if (text.includes('getApiSession(') || text.includes('requireApiSession(')) return 'session';
  return 'unspecified';
}

function main() {
  const selectNavFields = ({ href, fallbackLabel }: { href: string; fallbackLabel: string }) => ({
    href,
    fallbackLabel,
  });
  const mainNav = mainNavItems.map(selectNavFields);
  const systemNav = systemNavItems.map(selectNavFields);
  const mobileHrefs = mobileNavItems.map(({ href }) => href);

  const pages = walk(APP)
    .filter((f) => f.endsWith('/page.tsx'))
    .sort()
    .map((f) => {
      const rel = relative(ROOT, f);
      const text = readFileSync(f, 'utf8');
      const path = pagePathFor(f);
      const permissions = declaredPerms(text);
      return {
        path,
        file: rel,
        inSidebarMain: mainNav.some((m) => m.href === path),
        inSidebarSystem: systemNav.some((s) => s.href === path),
        declaredPermissions: permissions,
        navigationPermissions: navigationPerms(text, permissions),
      };
    });

  const apiRoutes = walk(join(APP, 'api'))
    .filter((f) => f.endsWith('/route.ts'))
    .sort()
    .map((f) => {
      const rel = relative(ROOT, f);
      const text = readFileSync(f, 'utf8');
      const routeRel = relative(join(APP, 'api'), f);
      const path = '/api/' + routeRel.slice(0, -'/route.ts'.length);
      return {
        path,
        file: rel,
        methods: apiMethods(text, f),
        guardMode: guardMode(text),
        declaredPermissions: declaredPerms(text),
      };
    });

  const rbacText = readFileSync(RBAC_FILE, 'utf8');
  const permsMatch = rbacText.match(/export const PERMISSIONS\s*=\s*\[([\s\S]*?)\];/);
  const permissions = permsMatch
    ? [...permsMatch[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
    : [];

  const catalog = {
    generatedAt: new Date().toISOString(),
    summary: {
      sidebarMain: mainNav.length,
      sidebarSystem: systemNav.length,
      sidebarMobile: mobileHrefs.length,
      pages: pages.length,
      apiRoutes: apiRoutes.length,
      permissionsDefined: permissions.length,
    },
    sidebar: {
      main: mainNav,
      system: systemNav,
      mobileHrefs,
    },
    pages,
    apiRoutes,
    permissions,
  };

  let outputCatalog = catalog;
  let previousText = '';
  if (existsSync(OUT)) {
    previousText = readFileSync(OUT, 'utf8');
    try {
      const previous = JSON.parse(previousText) as typeof catalog;
      const previousStable = { ...previous, generatedAt: undefined };
      const nextStable = { ...catalog, generatedAt: undefined };
      if (JSON.stringify(previousStable) === JSON.stringify(nextStable)) {
        outputCatalog = { ...catalog, generatedAt: previous.generatedAt };
      }
    } catch {
      // Replace malformed or obsolete generated output below.
    }
  }

  const nextText = JSON.stringify(outputCatalog, null, 2) + '\n';
  if (nextText !== previousText) {
    writeFileSync(OUT, nextText);
    console.log(`wrote ${OUT} (${statSync(OUT).size} bytes)`);
  } else {
    console.log(`unchanged ${OUT} (${statSync(OUT).size} bytes)`);
  }
  console.log('summary:', catalog.summary);
}

main();
