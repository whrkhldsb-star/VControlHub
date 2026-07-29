#!/usr/bin/env tsx
/**
 * Audit user-visible API/backend error copy that is still hard-coded in English.
 *
 * The script is intentionally conservative: it flags obvious response/error
 * construction patterns containing quoted English prose, then compares the
 * current findings against docs/api-copy-audit-baseline.json when present.
 * This lets CI prevent regressions while the remaining historical debt is
 * paid down module by module.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

type Finding = {
  file: string;
  line: number;
  pattern: string;
  text: string;
};

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, "docs", "api-copy-audit-baseline.json");

const FILE_GLOBS = ["src/app/api", "src/lib"];
const INCLUDE_EXT = /\.(ts|tsx)$/;
const TEST_OR_DICT = /(__tests__|\.test\.|src\/lib\/i18n\/dictionaries\/|src\/lib\/i18n\/translations\.ts|src\/lib\/http\/api-error\.ts|src\/lib\/errors\.ts)/;
const ALLOW_INLINE = "api-copy-audit: allow";

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "json-error", re: /\b(?:NextResponse|Response)\.json\s*\([^\n]*(?:error|message)\s*:\s*(["'`])([^"'`]*[A-Za-z][^"'`]*)\1/ },
  { name: "typed-error", re: /new\s+(?:AuthError|ForbiddenError|NotFoundError|ValidationError|ConflictError|BusinessError|AppError)\s*\([^\n]*(["'`])([^"'`]*[A-Za-z][^"'`]*)\1/ },
  { name: "api-error", re: /\bapiError\s*\([^\n]*(["'`])([^"'`]*[A-Za-z][^"'`]*)\1/ },
  { name: "guard-error-message", re: /\berrorMessage\s*:\s*(["'`])([^"'`]*[A-Za-z][^"'`]*)\1/ },
];

function listFiles(): string[] {
  const output = execFileSync("git", ["ls-files", ...FILE_GLOBS], { cwd: ROOT, encoding: "utf8" });
  return output
    .split("\n")
    .filter(Boolean)
    .filter((file) => INCLUDE_EXT.test(file) && !TEST_OR_DICT.test(file))
    .filter((file) => existsSync(join(ROOT, file)));
}

function isLikelyUserCopy(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Machine codes and identifiers are fine.
  if (/^[A-Z0-9_:-]+$/.test(trimmed)) return false;
  if (/^[a-z0-9_.:-]+$/.test(trimmed)) return false;
  // Command/template snippets and intentional protocol names are not product copy.
  if (/^(GET|POST|PUT|PATCH|DELETE)\b/.test(trimmed)) return false;
  return /[A-Za-z]{3,}/.test(trimmed);
}

function scan(): Finding[] {
  const findings: Finding[] = [];
  for (const file of listFiles()) {
    const abs = join(ROOT, file);
    const lines = readFileSync(abs, "utf8").split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.includes(ALLOW_INLINE)) return;
      if (line.includes("t(") || line.includes("serverT(") || line.includes("getErrorMessage(")) return;
      for (const pattern of PATTERNS) {
        const match = line.match(pattern.re);
        const text = match?.[2] ?? "";
        if (text && isLikelyUserCopy(text)) {
          findings.push({ file, line: idx + 1, pattern: pattern.name, text });
          break;
        }
      }
    });
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.text.localeCompare(b.text));
}

function keyOf(f: Finding): string {
  return `${f.file}:${f.pattern}:${f.text}`;
}

const findings = scan();

if (process.argv.includes("--write-baseline")) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ count: findings.length, findings }, null, 2)}\n`);
  console.log(`api-copy audit baseline written: ${findings.length} finding(s)`);
  process.exit(0);
}

if (existsSync(BASELINE_PATH)) {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as { findings?: Finding[] };
  const baselineKeys = new Set((baseline.findings ?? []).map(keyOf));
  const regressions = findings.filter((finding) => !baselineKeys.has(keyOf(finding)));
  if (regressions.length > 0) {
    console.error(`api-copy audit found ${regressions.length} new hard-coded English API/backend copy finding(s):`);
    for (const f of regressions.slice(0, 25)) {
      console.error(`- ${relative(ROOT, join(ROOT, f.file))}:${f.line} [${f.pattern}] ${f.text}`);
    }
    if (regressions.length > 25) console.error(`... and ${regressions.length - 25} more`);
    console.error("Run `npm run api-copy:audit:baseline` only after reviewing and reducing intentional debt.");
    process.exit(1);
  }
}

console.log(`api-copy audit ok: ${findings.length} finding(s), no regressions`);
