/**
 * scripts/i18n-key-completeness.ts
 *
 * Static analyzer that checks every `t("...")` / `trTpl("...")` /
 * `tplT("...")` call site in `src/` resolves to a key present in
 * `src/lib/i18n/dictionaries/*.ts` (both zh and en sections).
 *
 * Why this exists: previous i18n sweep rounds replaced hardcoded
 * strings with `t()` calls but forgot to add the matching dict entries,
 * causing UI to fall back to the raw key string (e.g. user saw
 * `sharesPage.button.compact` instead of "分享"). This script catches
 * that class of bug at verify-time so it can't reach production.
 *
 * Usage:
 *   tsx scripts/i18n-key-completeness.ts
 *
 * Exits non-zero if any missing or orphaned keys are found, so it can
 * be wired into CI / pre-commit.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");
const DICT_DIR = join(SRC, "lib", "i18n", "dictionaries");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(p);
  }
  return out;
}

const CODE_FILES = walk(SRC, [".ts", ".tsx"]).filter(
  (p) => !p.includes("/i18n/dictionaries/"),
);

const DICT_FILES = readdirSync(DICT_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => join(DICT_DIR, f));

// --- Collect translation keys referenced in code ---
const used = new Set<string>();
const referencedLiterals = new Set<string>();
const dynamicKeyPatterns: RegExp[] = [];
const _tRegex = /\bt(?:\(\s*|plT\(\s*|rTpl\(\s*|\s+extends\s+\w+\s*\?\s*)['"]([a-zA-Z][a-zA-Z0-9_.]+)['"]/g;
// Match the simple dominant patterns: t("..."), tplT("..."), trTpl("...") — and the rare t("k", ...)
const tSimple = /\b(?:t|tplT|trTpl)\(\s*['"]([a-zA-Z][a-zA-Z0-9_.]+)['"]/g;

// Strip block comments (/* ... */) and line comments (// ...) before
// scanning, so docstrings with example `t("...")` calls don't trigger
// false positives.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

for (const f of CODE_FILES) {
  const raw = readFileSync(f, "utf8");
  const src = stripComments(raw);
  for (const m of src.matchAll(tSimple)) {
    const key = m[1];
    if (key) used.add(key);
  }
	// Keys are frequently routed through small wrappers (`tt(key)`, schema
	// metadata, label maps) before reaching t(). Count any dictionary-shaped
	// string literal in executable source as an indirect reference.
	for (const m of src.matchAll(/['"]([a-zA-Z][a-zA-Z0-9_.]+)['"]/g)) {
		if (m[1]) referencedLiterals.add(m[1]);
	}
	// Also understand template-prefix lookups such as
	// t(`audit.action.${action}`) and t(`status.${kind}.label`).
	for (const m of src.matchAll(/`([^`]*\$\{[^`]+)`/g)) {
		const template = m[1];
		if (!template) continue;
		const staticParts = template.split(/\$\{[^}]+\}/g);
		const staticText = staticParts.join("");
		// Ignore generic templates such as `${value}` or URLs. A translation
		// family must retain a stable dotted namespace in its static portion.
		if (!/[a-zA-Z][a-zA-Z0-9_]*\./.test(staticText)) continue;
		const escaped = staticParts
			.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join(".+");
		dynamicKeyPatterns.push(new RegExp(`^${escaped}$`));
	}
	for (const m of src.matchAll(/['"]([a-zA-Z][a-zA-Z0-9_.]*\.)['"]\s*\+/g)) {
		const prefix = m[1];
		if (prefix) dynamicKeyPatterns.push(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.+$`));
	}
}

// --- Collect keys defined in dictionaries ---
const definedZh = new Set<string>();
const definedEn = new Set<string>();
const dictFileKeys = new Map<string, Set<string>>();

for (const f of DICT_FILES) {
  const src = readFileSync(f, "utf8");
  // Each dict exports zh and en (or locale consts). Find sections.
  // Match "key": 'value' or "key": "value" — both quote styles allowed.
  const keyValue = /"([a-zA-Z][a-zA-Z0-9_.]+)"\s*:\s*['"]/g;
  // Heuristic: assume zh comes first; track section by looking for
  // "export const zh" / "export const en" markers.
  const zhStart = src.indexOf("export const zh");
  const enStart = src.indexOf("export const en");
  const sets: { set: Set<string>; start: number; end: number }[] = [];
  if (zhStart >= 0) sets.push({ set: definedZh, start: zhStart, end: enStart > 0 ? enStart : src.length });
  if (enStart >= 0) sets.push({ set: definedEn, start: enStart, end: src.length });
  for (const { set, start, end } of sets) {
    const slice = src.slice(start, end);
    for (const m of slice.matchAll(keyValue)) {
      const key = m[1];
      if (key) set.add(key);
    }
  }
  // Also map each key to its file for reports.
  const fileKeys = dictFileKeys.get(f) ?? new Set<string>();
  for (const m of src.matchAll(keyValue)) {
    const key = m[1];
    if (key) fileKeys.add(key);
  }
  dictFileKeys.set(f, fileKeys);
}

const definedAll = new Set<string>([...definedZh, ...definedEn]);

for (const key of definedAll) {
	if (referencedLiterals.has(key) || dynamicKeyPatterns.some((pattern) => pattern.test(key))) {
		used.add(key);
	}
}

// --- Diff ---
const missingInDict = [...used].filter((k) => !definedAll.has(k)).sort();
const orphanInDict = [...definedAll].filter((k) => !used.has(k)).sort();
const zhEnMismatch = [...definedAll].filter((k) => definedZh.has(k) !== definedEn.has(k)).sort();

if (process.argv.includes("--prune") && orphanInDict.length > 0) {
	const orphanSet = new Set(orphanInDict);
	let removed = 0;
	for (const file of DICT_FILES) {
		const source = readFileSync(file, "utf8");
		const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		const edits: Array<{ start: number; end: number }> = [];
		function visit(node: ts.Node) {
			if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isNoSubstitutionTemplateLiteral(node.name))) {
				if (orphanSet.has(node.name.text)) {
					let end = node.end;
					while (end < source.length && (source[end] === " " || source[end] === "\t")) end++;
					if (source[end] === ",") end++;
					edits.push({ start: node.getFullStart(), end });
					removed++;
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
		let next = source;
		for (const edit of edits.sort((a, b) => b.start - a.start)) {
			next = next.slice(0, edit.start) + next.slice(edit.end);
		}
		if (edits.length > 0) writeFileSync(file, next, "utf8");
	}
	console.log(`[PRUNE] removed ${removed} locale entries for ${orphanInDict.length} orphan keys`);
	process.exit(0);
}

console.log(`\n[ i18n-key-completeness ]`);
console.log(`  used=${used.size}  definedZh=${definedZh.size}  definedEn=${definedEn.size}`);
console.log(`  missingInDict=${missingInDict.length}  orphanInDict=${orphanInDict.length}  zhEnMismatch=${zhEnMismatch.length}`);

if (missingInDict.length > 0) {
  console.error(`\n[FAIL] ${missingInDict.length} t() key(s) used in code but not in any dictionary (UI falls back to key string):`);
  for (const k of missingInDict) console.error(`  - ${k}`);
}

if (zhEnMismatch.length > 0) {
  console.error(`\n[FAIL] ${zhEnMismatch.length} key(s) present in only one of zh/en (locale fallback leaks):`);
  for (const k of zhEnMismatch) {
    const inZh = definedZh.has(k) ? "zh" : "  ";
    const inEn = definedEn.has(k) ? "en" : "  ";
    console.error(`  - ${k} (${inZh} ${inEn})`);
  }
}

if (orphanInDict.length > 0) {
  console.warn(`\n[WARN] ${orphanInDict.length} dict key(s) not referenced by any t() call (likely dead, may be referenced via template-prefix patterns):`);
	const orphanPreview = process.env.I18N_SHOW_ALL_ORPHANS === "1" ? orphanInDict : orphanInDict.slice(0, 30);
  for (const k of orphanPreview) console.warn(`  - ${k}`);
  if (orphanInDict.length > orphanPreview.length) console.warn(`  ... and ${orphanInDict.length - orphanPreview.length} more`);
}

if (missingInDict.length > 0 || zhEnMismatch.length > 0 || orphanInDict.length > 0) {
  process.exit(1);
}
console.log("\n[OK] all t() keys resolved in zh+en dictionaries; no orphan keys");
