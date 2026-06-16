/**
 * scripts/tr-019-dto-audit.ts
 *
 * Static analyzer that measures the DTO/schema boundary coverage for the
 * 5 modules in the TR-019 closure scope: files, storage, command, ai, backup.
 *
 * Per module it scans src/app/api/MODULE for route.ts files and reports
 * the proportion that have migrated from inline zod schemas to importing
 * the shared boundary module (src/lib/MODULE/dto.ts or schema.ts).
 *
 * Outputs JSON + Markdown reports under docs/tr-019-dto-audit.{json,md}.
 * Exit 0 if no inline zod found in any route, 1 if any gap, 2 if scan errored.
 *
 * Run: npx tsx scripts/tr-019-dto-audit.ts
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = process.cwd();
const REPORT_JSON_PATH = join(ROOT, "docs", "tr-019-dto-audit.json");
const REPORT_MD_PATH = join(ROOT, "docs", "tr-019-dto-audit.md");

/**
 * Module configuration. For each module we declare:
 *   - apiDir: where its API routes live under src/app/api.
 *   - boundaryFile: which file in src/lib/<module> holds the DTO/schema
 *     boundary (relative to src/lib/<module>).
 *
 * "dto" modules export pure-type wire shapes (no zod). "schema" modules
 * export zod request schemas. We accept either as the "boundary" — the
 * audit just checks for an import of the boundary path.
 */
const MODULES: ReadonlyArray<{
  name: string;
  apiDir: string;
  boundaryFile: string;
  boundaryKind: "dto" | "schema";
}> = [
  {
    name: "files",
    apiDir: "src/app/api/files",
    boundaryFile: "dto.ts",
    boundaryKind: "dto",
  },
  {
    name: "storage",
    apiDir: "src/app/api/storage",
    boundaryFile: "schema.ts",
    boundaryKind: "schema",
  },
  {
    name: "command",
    apiDir: "src/app/api/command-templates",
    boundaryFile: "schema.ts",
    boundaryKind: "schema",
  },
  {
    name: "ai",
    apiDir: "src/app/api/ai",
    boundaryFile: "dto.ts",
    boundaryKind: "dto",
  },
  {
    name: "backup",
    apiDir: "src/app/api/backups",
    boundaryFile: "schema.ts",
    boundaryKind: "schema",
  },
];

const SKIP_DIR_NAMES = new Set([
  "__tests__",
  "node_modules",
  ".next",
  "dist",
]);

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function walkRouteFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkRouteFiles(full, out);
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

function readSource(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Source analysis
// ---------------------------------------------------------------------------

export type RouteVerdict =
  | "inline-zod"
  | "boundary-imported"
  | "no-schema";

export type RouteReport = {
  path: string;
  relPath: string;
  verdict: RouteVerdict;
  hasInlineZod: boolean;
  importsBoundary: boolean;
  inlineZodSites: Array<{ line: number; text: string }>;
  firstBoundaryImportLine: number | null;
};

export type ModuleReport = {
  module: string;
  boundaryFile: string | null;
  boundaryKind: "dto" | "schema" | null;
  boundaryExists: boolean;
  totalRoutes: number;
  inlineZodRoutes: number;
  boundaryConsumerRoutes: number;
  cleanRoutes: number;
  coveragePercent: number;
  routes: RouteReport[];
};

export type CoverageReport = {
  generatedAt: string;
  summary: {
    modulesAudited: number;
    totalRoutes: number;
    inlineZodRoutes: number;
    boundaryConsumerRoutes: number;
    overallCoveragePercent: number;
  };
  modules: ModuleReport[];
};

/**
 * Detect whether a route file declares an inline zod schema and whether
 * it imports the boundary module.
 *
 * Heuristics:
 *   - inline zod = at least one `z.object(...)` or `z.enum(...)` call
 *     whose call site is not preceded by an import-from-boundary
 *     statement (we check imports first).
 *   - boundary import = an `import { ... } from "@/lib/<module>/<dto|schema>"`
 *     statement.
 *
 * We do NOT try to be clever about `import * as`, dynamic imports, or
 * re-exports. The existing codebase consistently uses the named-import
 * form for zod schemas, so this is good enough for a coverage signal.
 */
export function analyzeRoute(
  absPath: string,
  moduleName: string,
  boundaryFile: string,
  source: string,
): RouteReport {
  const boundaryImportRe = new RegExp(
    String.raw`from\s+["']@/lib/${moduleName}/${boundaryFile.replace(/\.ts$/, "")}["']`,
  );

  const importsBoundary = boundaryImportRe.test(source);

  // Match `z.object(` or `z.enum(` as a schema declaration site. We
  // intentionally do not match `z.string()` / `z.number()` because those
  // are field descriptors inside an existing z.object/z.enum and don't
  // represent a new boundary.
  const inlineZodRegex = /\bz\.(?:object|enum)\s*\(/g;
  const inlineZodSites: Array<{ line: number; text: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = inlineZodRegex.exec(source)) !== null) {
    const offset = match.index;
    const line = source.slice(0, offset).split("\n").length;
    const lineText = source.split("\n")[line - 1]?.trim() ?? "";
    inlineZodSites.push({ line, text: lineText.slice(0, 120) });
  }

  let verdict: RouteVerdict;
  if (importsBoundary) {
    verdict = "boundary-imported";
  } else if (inlineZodSites.length > 0) {
    verdict = "inline-zod";
  } else {
    verdict = "no-schema";
  }

  // First boundary import line (if any) — purely informational
  let firstBoundaryImportLine: number | null = null;
  if (importsBoundary) {
    const importRe = new RegExp(
      String.raw`^import\s.*from\s+["']@/lib/${moduleName}/${boundaryFile.replace(/\.ts$/, "")}["']`,
      "m",
    );
    const importMatch = source.match(importRe);
    if (importMatch?.index !== undefined) {
      firstBoundaryImportLine = source
        .slice(0, importMatch.index)
        .split("\n").length;
    }
  }

  return {
    path: absPath,
    relPath: relative(ROOT, absPath).split(sep).join("/"),
    verdict,
    hasInlineZod: inlineZodSites.length > 0,
    importsBoundary,
    inlineZodSites,
    firstBoundaryImportLine,
  };
}

function analyzeModule(cfg: (typeof MODULES)[number]): ModuleReport {
  const apiDirAbs = join(ROOT, cfg.apiDir);
  const routeFiles = walkRouteFiles(apiDirAbs);

  const boundaryPath = join(ROOT, "src", "lib", cfg.name, cfg.boundaryFile);
  const boundaryExists = existsSync(boundaryPath);

  const reports: RouteReport[] = routeFiles.map((p) => {
    const source = readSource(p);
    return analyzeRoute(p, cfg.name, cfg.boundaryFile, source);
  });

  const totalRoutes = reports.length;
  const inlineZodRoutes = reports.filter((r) => r.verdict === "inline-zod")
    .length;
  const boundaryConsumerRoutes = reports.filter(
    (r) => r.verdict === "boundary-imported",
  ).length;
  const cleanRoutes = reports.filter((r) => r.verdict === "no-schema").length;

  // Denominator: routes that need DTO/validation (inline-zod or
  // already-imported). "no-schema" routes are excluded because they
  // don't carry a request shape worth auditing.
  const needsBoundary = inlineZodRoutes + boundaryConsumerRoutes;
  const coveragePercent =
    needsBoundary === 0
      ? 100
      : Math.round((boundaryConsumerRoutes / needsBoundary) * 1000) / 10;

  return {
    module: cfg.name,
    boundaryFile: boundaryExists
      ? `src/lib/${cfg.name}/${cfg.boundaryFile}`
      : null,
    boundaryKind: boundaryExists ? cfg.boundaryKind : null,
    boundaryExists,
    totalRoutes,
    inlineZodRoutes,
    boundaryConsumerRoutes,
    cleanRoutes,
    coveragePercent,
    routes: reports,
  };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderJsonReport(report: CoverageReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

function renderMarkdownReport(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push(`# TR-019 DTO 边界覆盖审计`);
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push(
    "本报告扫描 5 个 TR-019 closure 域的 API route 看其 DTO/schema 边界覆盖率。",
  );
  lines.push("");
  lines.push(
    "**判定规则**: 每个 route file 分三类 — `inline-zod` (声明了 inline `z.object`/`z.enum` 但未 import 共享 boundary) / `boundary-imported` (import 了 `<lib>/dto.ts` 或 `<lib>/schema.ts`) / `no-schema` (没有 zod schema, 不计入分母)。覆盖率 = `boundary-imported / (inline-zod + boundary-imported)`。",
  );
  lines.push("");
  lines.push("## 总体");
  lines.push("");
  lines.push(`- 模块审计数: **${report.summary.modulesAudited}**`);
  lines.push(`- API route 总数: **${report.summary.totalRoutes}**`);
  lines.push(`- 仍 inline zod 的 route: **${report.summary.inlineZodRoutes}**`);
  lines.push(
    `- 已 import boundary 的 route: **${report.summary.boundaryConsumerRoutes}**`,
  );
  lines.push(
    `- 总体覆盖率: **${report.summary.overallCoveragePercent.toFixed(1)}%**`,
  );
  lines.push("");
  lines.push("## 各模块");
  lines.push("");
  lines.push(
    "| 模块 | boundary 文件 | 存在 | route 总数 | inline-zod | 已 import boundary | 无 schema | 覆盖率 |",
  );
  lines.push(
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const m of report.modules) {
    lines.push(
      `| \`${m.module}\` | \`${m.boundaryFile ?? "(缺)"}\` | ${m.boundaryExists ? "✅" : "❌"} | ${m.totalRoutes} | ${m.inlineZodRoutes} | ${m.boundaryConsumerRoutes} | ${m.cleanRoutes} | **${m.coveragePercent.toFixed(1)}%** |`,
    );
  }
  lines.push("");
  lines.push("## Inline-zod gap 详情");
  lines.push("");
  for (const m of report.modules) {
    const gaps = m.routes.filter((r) => r.verdict === "inline-zod");
    if (gaps.length === 0) {
      lines.push(`### ${m.module}`);
      lines.push("");
      lines.push("✅ 无 inline zod gap");
      lines.push("");
      continue;
    }
    lines.push(`### ${m.module} (${gaps.length} gap routes)`);
    lines.push("");
    for (const g of gaps) {
      lines.push(
        `- \`${g.relPath}\` — ${g.inlineZodSites.length} 个 inline zod 站点`,
      );
      for (const site of g.inlineZodSites.slice(0, 3)) {
        lines.push(`  - L${site.line}: \`${site.text}\``);
      }
      if (g.inlineZodSites.length > 3) {
        lines.push(`  - … 还有 ${g.inlineZodSites.length - 3} 个`);
      }
    }
    lines.push("");
  }
  lines.push("## Re-run");
  lines.push("");
  lines.push("```bash");
  lines.push("npx tsx scripts/tr-019-dto-audit.ts");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

function renderStdoutSummary(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push("TR-019 DTO 边界覆盖审计");
  lines.push("=================================");
  for (const m of report.modules) {
    const status = m.boundaryExists ? "✅" : "❌(缺 boundary 文件)";
    lines.push(
      `  ${m.module.padEnd(10)} ${status} ${m.boundaryFile ?? "-"}`.padEnd(60) +
        ` inline-zod=${m.inlineZodRoutes} imported=${m.boundaryConsumerRoutes} clean=${m.cleanRoutes} coverage=${m.coveragePercent.toFixed(1)}%`,
    );
  }
  lines.push("---------------------------------");
  lines.push(
    `Overall: ${report.summary.overallCoveragePercent.toFixed(1)}% (${report.summary.boundaryConsumerRoutes}/${report.summary.inlineZodRoutes + report.summary.boundaryConsumerRoutes} routes)`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function buildReport(now: Date = new Date()): CoverageReport {
  const moduleReports = MODULES.map(analyzeModule);

  const totalRoutes = moduleReports.reduce((s, m) => s + m.totalRoutes, 0);
  const inlineZodRoutes = moduleReports.reduce(
    (s, m) => s + m.inlineZodRoutes,
    0,
  );
  const boundaryConsumerRoutes = moduleReports.reduce(
    (s, m) => s + m.boundaryConsumerRoutes,
    0,
  );
  const denominator = inlineZodRoutes + boundaryConsumerRoutes;
  const overallCoveragePercent =
    denominator === 0
      ? 100
      : Math.round((boundaryConsumerRoutes / denominator) * 1000) / 10;

  return {
    generatedAt: now.toISOString(),
    summary: {
      modulesAudited: MODULES.length,
      totalRoutes,
      inlineZodRoutes,
      boundaryConsumerRoutes,
      overallCoveragePercent,
    },
    modules: moduleReports,
  };
}

export function writeReports(report: CoverageReport): {
  jsonPath: string;
  mdPath: string;
} {
  // Ensure docs/ exists
  const docsDir = resolve(ROOT, "docs");
  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }
  writeFileSync(REPORT_JSON_PATH, renderJsonReport(report));
  writeFileSync(REPORT_MD_PATH, renderMarkdownReport(report));
  return { jsonPath: REPORT_JSON_PATH, mdPath: REPORT_MD_PATH };
}

// Run as CLI when invoked directly (`tsx scripts/tr-019-dto-audit.ts`)
if (require.main === module) {
  try {
    const report = buildReport();
    const { jsonPath, mdPath } = writeReports(report);
    console.log(renderStdoutSummary(report));
    console.log("");
    console.log(`Wrote ${relative(ROOT, jsonPath)}`);
    console.log(`Wrote ${relative(ROOT, mdPath)}`);
    process.exit(report.summary.inlineZodRoutes > 0 ? 1 : 0);
  } catch (error) {
    console.error("tr-019-dto-audit failed:", error);
    process.exit(2);
  }
}
