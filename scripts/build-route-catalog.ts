/**
 * scripts/build-route-catalog.ts
 *
 * Generates docs/route-catalog.json from real source files so the catalog
 * stays the single source of truth for "sidebar → route → permission → API".
 *
 * Run: npx tsx scripts/build-route-catalog.ts
 */
import { writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

const ROOT = process.cwd();
const APP = join(ROOT, 'src', 'app');
const NAV_FILE = join(ROOT, 'src', 'components', 'nav-items.tsx');
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

function extractSection(text: string, start: string, end: string): string {
  const s = text.indexOf(start);
  const e = end ? text.indexOf(end, s + 1) : -1;
  return s >= 0 && e > 0 ? text.slice(s, e) : '';
}

function parseNavItems(block: string): { href: string; fallbackLabel: string }[] {
  const items: { href: string; fallbackLabel: string }[] = [];
  const re = /href:\s*"([^"]+)[\s\S]*?fallbackLabel:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    items.push({ href: m[1]!, fallbackLabel: m[2]! });
  }
  return items;
}

function declaredPerms(text: string): string[] {
  const re = /['"]([a-z][a-z0-9-]+:(?:read|write|manage|create|delete|approve|chat|hosted|action))['"]/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    set.add(m[1]!);
  }
  return [...set].sort();
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
    const target = resolve(targetDir, targetRel) + (targetRel.endsWith('route') ? '.ts' : '/route.ts');
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

function main() {
  const navText = readFileSync(NAV_FILE, 'utf8');
  const mainBlock = extractSection(navText, 'mainNavItems:', 'export const systemNavItems');
  const systemBlock = extractSection(navText, 'systemNavItems:', 'mobileNavHrefs');
  const mobileMatch = navText.match(/mobileNavHrefs\s*=\s*\[([\s\S]*?)\]/);
  const mobileHrefs = mobileMatch
    ? [...mobileMatch[1]!.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]!)
    : [];

  const mainNav = parseNavItems(mainBlock);
  const systemNav = parseNavItems(systemBlock);

  const pages = walk(APP)
    .filter((f) => f.endsWith('/page.tsx'))
    .sort()
    .map((f) => {
      const rel = relative(ROOT, f);
      const text = readFileSync(f, 'utf8');
      const path = pagePathFor(f);
      return {
        path,
        file: rel,
        inSidebarMain: mainNav.some((m) => m.href === path),
        inSidebarSystem: systemNav.some((s) => s.href === path),
        declaredPermissions: declaredPerms(text),
      };
    });

  const apiRoutes = walk(join(APP, 'api'))
    .filter((f) => f.endsWith('/route.ts'))
    .sort()
    .map((f) => {
      const rel = relative(ROOT, f);
      const text = readFileSync(f, 'utf8');
      const path = '/' + rel.slice(0, -'/route.ts'.length);
      return {
        path,
        file: rel,
        methods: apiMethods(text, f),
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

  writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`wrote ${OUT} (${statSync(OUT).size} bytes)`);
  console.log('summary:', catalog.summary);
}

main();
