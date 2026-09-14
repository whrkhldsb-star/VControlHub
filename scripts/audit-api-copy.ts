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
import { scanApiCopy } from "./api-copy-scanner";

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
function scan(): Finding[] {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...FILE_GLOBS], { cwd: ROOT, encoding: "utf8" });
  return [...new Set(files.split(String.fromCharCode(0)))].filter((file) => INCLUDE_EXT.test(file) && !TEST_OR_DICT.test(file) && existsSync(join(ROOT, file)))
    .flatMap((file) => scanApiCopy(file, readFileSync(join(ROOT, file), "utf8")))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function keyOf(f: Finding): string {
  return `${f.file}:${f.pattern}:${f.text}`;
}

const findings = scan();
if (process.argv.includes("--json")) { console.log(JSON.stringify(findings, null, 2)); process.exit(0); }

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
