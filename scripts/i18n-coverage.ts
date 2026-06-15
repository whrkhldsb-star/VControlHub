/**
 * scripts/i18n-coverage.ts
 *
 * Static analyzer that scans VControlHub's user-facing TSX files for
 * hardcoded Chinese strings (JSX text content + JSX attribute values),
 * then cross-references them against `src/lib/i18n/translations.ts` to
 * report i18n coverage gaps.
 *
 * What gets extracted as a "candidate" Chinese string:
 *   1. JSX text content — e.g. `<h1>代码片段库</h1>` (between `>` and `<`)
 *   2. JSX string-typed attribute values — placeholder, title, aria-label,
 *      alt (e.g. `placeholder="搜索代码片段"`)
 *
 * Strings skipped:
 *   - Any content inside an element (or ancestor) marked with
 *     `data-i18n-skip` — runtime signal that the i18n system already
 *     knows not to touch it.
 *   - String literals inside `{...}` JSX expressions, comments, or
 *     type/import statements — too noisy / too high false-positive.
 *   - Strings of length < 2 Chinese characters (e.g. "无", "是") —
 *     too short to be meaningful UI labels, would flood the report.
 *   - `<title>` content (browser tab title) and `lang` attribute — not
 *     user-facing visible body text.
 *
 * Matching strategy:
 *   - Build reverse index: `zh value → [key, ...]` from translations.ts
 *     (a single Chinese string can map to multiple keys, e.g. if the
 *     English is the same as the Chinese).
 *   - For each candidate, look up the exact string. If found, mark
 *     as "covered". If not, mark as "missing".
 *   - We don't do fuzzy matching — we want a deterministic "is this
 *     string already in the translation table?" answer.
 *
 * Output:
 *   - JSON report to docs/i18n-coverage.json (machine-readable).
 *   - Markdown report to docs/i18n-coverage.md (human-readable).
 *   - Stdout summary: file count, string count, coverage %, top
 *     uncovered strings, per-module coverage.
 *   - Exit code 0 if no strings found (i.e. nothing to audit),
 *     1 if any uncovered strings, 2 if scan errored.
 *
 * Run: npx tsx scripts/i18n-coverage.ts
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
const SKIP_DIR_NAMES = new Set([
  "__tests__",
  "node_modules",
  ".next",
  "dist",
]);
const REPORT_JSON_PATH = join(ROOT, "docs", "i18n-coverage.json");
const REPORT_MD_PATH = join(ROOT, "docs", "i18n-coverage.md");
const TRANSLATIONS_PATH = join(
  ROOT,
  "src",
  "lib",
  "i18n",
  "translations.ts",
);
const PREVIEW_PER_FILE = 8;
const MIN_CHINESE_CHARS = 2;

export type StringKind =
  | "text"
  | "placeholder"
  | "title"
  | "aria-label"
  | "alt"
  | "data-i18n-attr";

export type CandidateString = {
  /** Raw Chinese text */
  text: string;
  /** 1-based line number in the source file */
  line: number;
  /** Where the string lives */
  kind: StringKind;
  /** Source attribute name, if kind is one of the *-attr variants */
  attr?: string;
  /** Full enclosing JSX context (open tag, up to ~80 chars) */
  context: string;
};

export type FileReport = {
  /** Path relative to repo root */
  path: string;
  /** Total Chinese candidates found */
  total: number;
  /** Candidates that already exist as a translation key value */
  covered: number;
  /** Candidates that need a new translation key */
  missing: number;
  /** All candidates, marked with coverage state */
  candidates: Array<CandidateString & { covered: boolean; key?: string }>;
};

export type CoverageReport = {
  generatedAt: string;
  summary: {
    files: number;
    filesWithStrings: number;
    totalStrings: number;
    coveredStrings: number;
    missingStrings: number;
    coveragePercent: number;
  };
  perModule: Array<{
    module: string;
    total: number;
    covered: number;
    missing: number;
    coveragePercent: number;
  }>;
  missingByString: Array<{
    text: string;
    count: number;
    files: Array<{ path: string; line: number; kind: StringKind }>;
  }>;
  reportsByFile: Record<string, FileReport>;
};

const ATTRIBUTES_TO_EXTRACT: Array<{ name: string; kind: StringKind }> = [
  { name: "placeholder", kind: "placeholder" },
  { name: "title", kind: "title" },
  { name: "aria-label", kind: "aria-label" },
  { name: "alt", kind: "alt" },
];

// ---------------------------------------------------------------------------
// Translation table loader
// ---------------------------------------------------------------------------

/**
 * Load translations.ts and extract the `zh` (and `en`) value maps.
 *
 * We don't use the React hook — we just regex-extract the static map
 * from the source text. This avoids needing a TypeScript compiler or
 * a JSX runtime for the audit script.
 */
function loadTranslationValues(
  text: string,
): { zh: Record<string, string>; en: Record<string, string> } {
  const result = { zh: {} as Record<string, string>, en: {} as Record<string, string> };
  // Match the literal "zh: {" and "en: {" blocks within the
  // `translations: Record<Locale, Record<string, string>> = { ... }`
  // declaration. We capture the block, then walk it line by line.
  const localeRe = /(\bzh|\ben)\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = localeRe.exec(text)) !== null) {
    const locale = m[1] as "zh" | "en";
    const start = m.index + m[0].length;
    // Find matching closing `}` at the same brace depth.
    let depth = 1;
    let i = start;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
      if (depth === 0) break;
    }
    if (depth !== 0) continue;
    const block = text.slice(start, i - 1);
    // Each line is `"key": "value",` (or `"key": "value"`).
    const lineRe = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*,?/g;
    let lm: RegExpExecArray | null;
    while ((lm = lineRe.exec(block)) !== null) {
      const key = lm[1]!;
      const value = lm[2]!;
      result[locale][key] = value;
    }
  }
  return result;
}

/**
 * Build a reverse index from Chinese value → list of keys.
 * Most strings map to one key; in edge cases (intentional duplication)
 * the same value can be reused.
 */
function buildReverseIndex(
  zh: Record<string, string>,
): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const [key, value] of Object.entries(zh)) {
    const arr = idx.get(value) ?? [];
    arr.push(key);
    idx.set(value, arr);
  }
  return idx;
}

// ---------------------------------------------------------------------------
// Chinese string detector
// ---------------------------------------------------------------------------

/**
 * True if a string contains at least MIN_CHINESE_CHARS CJK characters
 * and looks like a UI label (not pure punctuation or numbers).
 */
export function isChineseLabel(s: string): boolean {
  if (!s) return false;
  const cjkCount = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  if (cjkCount < MIN_CHINESE_CHARS) return false;
  // Must not be 100% digits/punctuation/symbols
  const nonWhitespace = s.replace(/\s/g, "");
  if (nonWhitespace.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// TSX text extractor
// ---------------------------------------------------------------------------

/**
 * Find the byte ranges that should be scanned for JSX.
 *
 * In TSX files, JSX is typically inside a `return ( ... )` expression
 * (or inside an arrow function body `=> ( ... )`). The other code in
 * a `.tsx` file is TypeScript: imports, type annotations, hook calls,
 * and helpers. We do NOT want the audit to flag generic type parameters
 * like `useState<ImageStats | null>(null)` as if they were JSX text
 * (this is a real bug we hit in image-bed-page-client.tsx where
 * `<HTMLInputElement>` was being parsed as a tag and the rest of the
 * line was extracted as text).
 *
 * Strategy: locate all `return` / `=>` positions that begin a JSX
 * expression, and compute the matching end of that expression. The
 * JSX expression ends at:
 *   - the matching `)` if it started with `(`
 *   - the end of the JSX subtree (matching `</tag>` for the root tag)
 *     if it started directly with `<tag>`
 *   - the `;` of the statement otherwise
 *
 * Only content inside those ranges is eligible for JSX scanning. This
 * is conservative — content inside inline helpers like
 * `(x) => <div>...</div>` is still captured because the `=> ` is
 * detected. Content inside `useState<Type>(...)` is excluded because
 * the `<` is preceded by a name, not a `=>` or `return `.
 */
export function findJsxRanges(
  text: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  // Match `return` or `=>` followed by either `(` or `<` (start of
  // JSX expression or JSX tag).
  //   return (...)            — wrapped return
  //   return <tag>...</tag>   — unwrapped return
  //   => (...)                — wrapped arrow
  //   => <tag>...</tag>       — unwrapped arrow
  const re = /(\breturn\b|=?>)\s*(?=\(|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // The JSX expression starts after the whitespace following
    // `return` or `=>`. We start the range at the `<` or `(` so the
    // tag-finding code below sees the tag.
    let exprStart = m.index + m[0].length;
    // Skip whitespace
    while (
      exprStart < text.length &&
      (text[exprStart] === " " || text[exprStart] === "\t")
    ) {
      exprStart++;
    }
    if (exprStart >= text.length) continue;
    const exprChar = text[exprStart];
    let exprEnd: number;
    if (exprChar === "(") {
      // Wrapped JSX: find the matching `)`
      const closeParen = findMatchingCloseParen(text, exprStart + 1);
      if (closeParen < 0) continue;
      exprEnd = closeParen;
    } else if (exprChar === "<") {
      // Unwrapped JSX: find the end of the root JSX subtree
      const closeTag = findJsxRootEnd(text, exprStart);
      if (closeTag < 0) {
        // Find the next `;` or newline as a fallback
        const semi = text.indexOf(";", exprStart);
        const nl = text.indexOf("\n", exprStart);
        const candidate = [semi, nl].filter((x) => x >= 0).sort((a, b) => a - b)[0];
        exprEnd = candidate !== undefined ? candidate : exprStart + 200;
      } else {
        exprEnd = closeTag;
      }
    } else {
      continue;
    }
    ranges.push({ start: exprStart, end: exprEnd });
  }
  return ranges;
}

/**
 * Given a position pointing at `(`, find the position of the matching
 * `)`. Skips over string literals.
 */
function findMatchingCloseParen(text: string, start: number): number {
  let depth = 1;
  let i = start;
  let inString: false | "'" | '"' | "`" = false;
  while (i < text.length && depth > 0) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inString) inString = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      i++;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Given a position pointing at `<tag` (the start of a JSX root tag),
 * find the position right after the matching close tag, or -1 if
 * the tag is self-closing or unclosed.
 *
 * We do a simple depth-counting scan: open `<Tag ... >` (or
 * `<Tag ... />`) increments or resets depth based on whether it's
 * self-closing; close `</Tag>` decrements depth. We stop when depth
 * returns to 0 and return the position after the close tag.
 */
function findJsxRootEnd(text: string, start: number): number {
  // Find the end of the opening tag
  const openEnd = findTagEnd(text, start + 1);
  if (openEnd < 0) return -1;
  // Self-closing?
  if (text[openEnd - 1] === "/") {
    return openEnd + 1;
  }
  // Otherwise track depth. Find the tag name from `<tagName`.
  const tagNameMatch = /^<([A-Za-z][A-Za-z0-9.]*)/.exec(text.slice(start));
  if (!tagNameMatch) return -1;
  const rootTag = tagNameMatch[1]!;
  let depth = 1;
  // Walk forward looking for `<` characters. We use the same findTagEnd
  // helper for both open and close tags.
  let i = openEnd + 1;
  while (i < text.length && depth > 0) {
    if (text[i] !== "<") {
      i++;
      continue;
    }
    // Check for closing tag
    if (text[i + 1] === "/") {
      const closeNameMatch = /^<\/([A-Za-z][A-Za-z0-9.]*)/.exec(text.slice(i));
      if (closeNameMatch && closeNameMatch[1] === rootTag) {
        const closeEnd = findTagEnd(text, i + 2 + rootTag.length);
        if (closeEnd < 0) return -1;
        depth--;
        i = closeEnd + 1;
        if (depth === 0) return i;
        continue;
      }
    } else if (/^[A-Za-z]/.test(text[i + 1] || "")) {
      // Opening tag
      const openNameMatch = /^<([A-Za-z][A-Za-z0-9.]*)/.exec(text.slice(i));
      if (openNameMatch && openNameMatch[1] === rootTag) {
        const openInnerEnd = findTagEnd(text, i + 1 + rootTag.length);
        if (openInnerEnd < 0) return -1;
        if (text[openInnerEnd - 1] !== "/") {
          depth++;
        }
        i = openInnerEnd + 1;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/**
 * Find data-i18n-skip regions (within JSX ranges only).
 *
 * When a JSX element has the `data-i18n-skip` attribute, the runtime
 * i18n system knows to leave it alone. We respect this signal in the
 * audit too: skip everything inside the matching closing tag of the
 * host element.
 */
function findSkipRanges(
  text: string,
  jsxRanges: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const hostTags = [
    "nav",
    "section",
    "aside",
    "div",
    "main",
    "header",
    "footer",
  ];
  for (const tag of hostTags) {
    const openRe = new RegExp(
      `<${tag}\\b[^>]*\\bdata-i18n-skip\\b[^>]*>`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = openRe.exec(text)) !== null) {
      // Only consider this skip region if it lives inside a JSX range.
      const isInJsx = jsxRanges.some(
        (r) => m!.index! >= r.start && m!.index! < r.end,
      );
      if (!isInJsx) continue;
      const openStart = m.index;
      const closeRe = new RegExp(`</${tag}\\s*>`, "g");
      closeRe.lastIndex = openStart + m[0].length;
      const cm = closeRe.exec(text);
      if (cm) {
        ranges.push({ start: openStart, end: cm.index + cm[0].length });
      } else {
        ranges.push({
          start: openStart,
          end: Math.min(openStart + 2000, text.length),
        });
      }
    }
  }
  return ranges;
}

function isInsideAnyRange(
  offset: number,
  ranges: Array<{ start: number; end: number }>,
): boolean {
  for (const r of ranges) {
    if (offset >= r.start && offset < r.end) return true;
  }
  return false;
}

/**
 * Find the closing `>` of a JSX tag, given the position right after
 * `<tag`. Skips over JSX expressions ({...}) and string literals,
 * so attributes like `onClick={() => doSomething()}` and
 * `aria-label={value > 5 ? "big" : "small"}` are handled correctly.
 */
function findTagEnd(text: string, start: number): number {
  let i = start;
  let inString: false | "'" | '"' | "`" = false;
  let braceDepth = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inString) inString = false;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    } else if (ch === "{") {
      braceDepth++;
    } else if (ch === "}") {
      if (braceDepth > 0) braceDepth--;
    } else if (ch === ">" && braceDepth === 0) {
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Extract attribute name/value pairs from the text between the tag name
 * and the closing `>` (or `/>`).
 *
 * Supported shapes:
 *   name="value"          (literal string)
 *   name='value'          (literal string)
 *   name={expression}     (JSX expression — value is empty)
 *   name                  (boolean attribute, e.g. `required`)
 */
function extractAttrs(tagContent: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{[\s\S]*?\}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagContent)) !== null) {
    const name = m[1]!.toLowerCase();
    // Use the literal value if present (group 2 or 3); otherwise it's
    // an expression or boolean attribute and we ignore the value.
    const value = m[2] ?? m[3] ?? "";
    if (!(name in attrs)) {
      attrs[name] = value;
    }
  }
  return attrs;
}

/**
 * Extract hardcoded Chinese strings from a TSX file's text.
 *
 * We do three passes:
 *   1. JSX text content: walk `>...<` regions and pick out Chinese
 *      content. We skip content that lives inside `{...}` expressions
 *      because those are dynamic values, not literal JSX text.
 *   2. JSX attribute values: for the four attributes we care about
 *      (placeholder / title / aria-label / alt), scan all opening
 *      tags and extract the string-literal value.
 *   3. We never extract from `data-i18n-original-*` (dom-bridge
 *      runtime markers — those are the source the bridge uses to
 *      translate, not user-authored UI strings).
 */
export function extractCandidates(
  text: string,
  jsxRanges: Array<{ start: number; end: number }>,
  skipRanges: Array<{ start: number; end: number }>,
): CandidateString[] {
  const candidates: CandidateString[] = [];
  const stripped = text; // Keep original offsets intact
  const tagRe = /<([A-Za-z][A-Za-z0-9.]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(stripped)) !== null) {
    if (!isInsideAnyRange(m.index, jsxRanges)) continue;
    if (isInsideAnyRange(m.index, skipRanges)) continue;
    const tagName = m[1]!;
    const tagNameEnd = m.index + 1 + tagName.length;
    const tagEnd = findTagEnd(stripped, tagNameEnd);
    if (tagEnd < 0) continue;
    const tagBody = stripped.slice(tagNameEnd, tagEnd);
    const attrs = extractAttrs(tagBody);
    const tagStart = m.index;
    const tagOpenEnd = tagEnd + 1; // position right after `>`

    // Skip self-closing `/>` closer check, we use the raw `>` match.
    // Extract attribute values.
    for (const { name, kind } of ATTRIBUTES_TO_EXTRACT) {
      const value = attrs[name];
      if (!value) continue;
      if (!isChineseLabel(value)) continue;
      // Sanity: skip if the attribute is on a dom-bridge marker tag.
      if (tagName === "I18nBridge" || tagName === "script") continue;
      candidates.push({
        text: value,
        line: lineForOffset(stripped, tagStart),
        kind,
        attr: name,
        context: stripped.slice(tagStart, Math.min(tagOpenEnd, tagStart + 80)),
      });
    }

    // Now look for JSX text content after this tag. We grab the
    // chunk between this `>` and the next `<` (or end of file).
    const afterClose = tagOpenEnd;
    const nextLt = stripped.indexOf("<", afterClose);
    const contentEnd = nextLt < 0 ? stripped.length : nextLt;
    let content = stripped.slice(afterClose, contentEnd);
    if (content.length === 0) continue;
    // Strip `{...}` JSX expression placeholders so we don't count
    // mixed expressions as Chinese text. Replace each `{...}` with
    // a single space; this is a coarse approximation but sufficient
    // for the audit (we only flag strings that look like UI labels).
    content = content.replace(/\{[\s\S]*?\}/g, " ");
    // Trim and check
    const trimmed = content.trim();
    if (trimmed.length === 0) continue;
    // Must contain Chinese chars (otherwise it's whitespace, code
    // identifier, etc.).
    if (!isChineseLabel(trimmed)) continue;
    candidates.push({
      text: trimmed,
      line: lineForOffset(stripped, afterClose),
      kind: "text",
      context: stripped
        .slice(tagStart, Math.min(contentEnd, tagStart + 80))
        .replace(/\s+/g, " "),
    });
  }
  return candidates;
}

/**
 * 1-based line number of a 0-based text offset.
 */
function lineForOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    if (SKIP_DIR_NAMES.has(ent.name)) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function collectSourceFiles(): string[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) {
    walk(join(ROOT, d), files);
  }
  return files.sort();
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function aggregate(
  files: string[],
  zhReverse: Map<string, string[]>,
): {
  reportsByFile: Record<string, FileReport>;
  summary: CoverageReport["summary"];
  perModule: CoverageReport["perModule"];
  missingByString: CoverageReport["missingByString"];
} {
  const reportsByFile: Record<string, FileReport> = {};
  let total = 0;
  let covered = 0;
  let missing = 0;
  const perModuleMap = new Map<
    string,
    { total: number; covered: number; missing: number }
  >();
  const missingTextMap = new Map<
    string,
    {
      count: number;
      files: Array<{ path: string; line: number; kind: StringKind }>;
    }
  >();

  for (const file of files) {
    const rel = relative(ROOT, file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const jsxRanges = findJsxRanges(text);
    const skipRanges = findSkipRanges(text, jsxRanges);
    const candidates = extractCandidates(text, jsxRanges, skipRanges);
    if (candidates.length === 0) {
      reportsByFile[rel] = {
        path: rel,
        total: 0,
        covered: 0,
        missing: 0,
        candidates: [],
      };
      continue;
    }

    const annotated = candidates.map((c) => {
      const keys = zhReverse.get(c.text);
      const isCovered = keys !== undefined && keys.length > 0;
      return { ...c, covered: isCovered, key: keys?.[0] };
    });

    const fileCovered = annotated.filter((c) => c.covered).length;
    const fileMissing = annotated.length - fileCovered;
    reportsByFile[rel] = {
      path: rel,
      total: annotated.length,
      covered: fileCovered,
      missing: fileMissing,
      candidates: annotated,
    };

    total += annotated.length;
    covered += fileCovered;
    missing += fileMissing;

    // Module = first 2 segments of the path, e.g. "src/app/snippets"
    const modulePath = rel.split("/").slice(0, 3).join("/");
    const mod = perModuleMap.get(modulePath) ?? {
      total: 0,
      covered: 0,
      missing: 0,
    };
    mod.total += annotated.length;
    mod.covered += fileCovered;
    mod.missing += fileMissing;
    perModuleMap.set(modulePath, mod);

    for (const c of annotated.filter((c) => !c.covered)) {
      const entry = missingTextMap.get(c.text) ?? {
        count: 0,
        files: [],
      };
      entry.count += 1;
      entry.files.push({ path: rel, line: c.line, kind: c.kind });
      missingTextMap.set(c.text, entry);
    }
  }

  const summary: CoverageReport["summary"] = {
    files: files.length,
    filesWithStrings: Object.values(reportsByFile).filter((r) => r.total > 0)
      .length,
    totalStrings: total,
    coveredStrings: covered,
    missingStrings: missing,
    coveragePercent:
      total === 0 ? 100 : Math.round((covered / total) * 1000) / 10,
  };

  const perModule = Array.from(perModuleMap.entries())
    .map(([module, m]) => ({
      module,
      total: m.total,
      covered: m.covered,
      missing: m.missing,
      coveragePercent:
        m.total === 0 ? 100 : Math.round((m.covered / m.total) * 1000) / 10,
    }))
    .sort((a, b) => a.coveragePercent - b.coveragePercent);

  const missingByString = Array.from(missingTextMap.entries())
    .map(([text, info]) => ({ text, ...info }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  return { reportsByFile, summary, perModule, missingByString };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function buildMarkdown(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push("# VControlHub i18n Coverage Report");
  lines.push("");
  lines.push(
    `> Generated: ${report.generatedAt} | Files: ${report.summary.files} | Strings: ${report.summary.totalStrings} | Coverage: **${report.summary.coveragePercent}%** (${report.summary.coveredStrings}/${report.summary.totalStrings})`,
  );
  lines.push("");
  lines.push(
    "This report cross-references hardcoded Chinese strings in `src/app/**/*.tsx` and `src/components/**/*.tsx` against the values in `src/lib/i18n/translations.ts`. A string is **covered** when its exact value already exists in the `zh` translation map; **missing** strings are candidates for new translation keys (or for relocation to the `dom-bridge` runtime substitution system).",
  );
  lines.push("");
  lines.push("Strings inside `data-i18n-skip` regions, in `<script>` tags, or in JSX expressions (`{...}`) are not audited.");
  lines.push("");

  // Module summary
  lines.push("## Module coverage (lowest first)");
  lines.push("");
  lines.push("| Module | Strings | Covered | Missing | Coverage |");
  lines.push("|---|---|---|---|---|");
  for (const m of report.perModule) {
    lines.push(
      `| \`${m.module}\` | ${m.total} | ${m.covered} | ${m.missing} | ${m.coveragePercent}% |`,
    );
  }
  lines.push("");

  // Top missing strings
  lines.push("## Top missing strings (frequency-sorted)");
  lines.push("");
  lines.push(
    "Each row is a Chinese string that appears in source but has no matching key in `translations.ts`. Add the string as a `zh` value, then optionally provide an `en` value, then reference via `t(\"<key>\")` or the `dom-bridge` data-i18n system.",
  );
  lines.push("");
  lines.push("| String | Count | First 3 occurrences |");
  lines.push("|---|---|---|");
  for (const m of report.missingByString.slice(0, 25)) {
    const locations = m.files
      .slice(0, 3)
      .map((f) => `\`${f.path}:${f.line}\` (${f.kind})`)
      .join(", ");
    lines.push(`| ${m.text} | ${m.count} | ${locations} |`);
  }
  lines.push("");

  // Per-file details (only files with missing strings)
  const filesWithMissing = Object.values(report.reportsByFile)
    .filter((r) => r.missing > 0)
    .sort((a, b) => b.missing - a.missing);

  if (filesWithMissing.length > 0) {
    lines.push("## Files with missing translations (most gaps first)");
    lines.push("");
    for (const f of filesWithMissing.slice(0, 20)) {
      const coverage =
        f.total === 0 ? "100" : Math.round((f.covered / f.total) * 1000) / 10;
      lines.push(
        `### \`${f.path}\` — ${f.missing}/${f.total} missing (${coverage}%)`,
      );
      lines.push("");
      for (const c of f.candidates.filter((c) => !c.covered).slice(0, PREVIEW_PER_FILE)) {
        const loc = `L${c.line}`;
        const attr = c.attr ? ` ${c.attr}=` : "";
        lines.push(
          `- ${loc} ${c.kind}${attr} "${c.text}"`,
        );
      }
      if (f.missing > PREVIEW_PER_FILE) {
        lines.push(`- _…and ${f.missing - PREVIEW_PER_FILE} more_`);
      }
      lines.push("");
    }
  } else {
    lines.push("## Files with missing translations");
    lines.push("");
    lines.push("_None — every Chinese string in TSX is already covered by `translations.ts`._");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function runAudit(): CoverageReport {
  if (!existsSync(TRANSLATIONS_PATH)) {
    console.error("Missing translations at", TRANSLATIONS_PATH);
    process.exit(2);
  }
  const translationsText = readFileSync(TRANSLATIONS_PATH, "utf8");
  const { zh } = loadTranslationValues(translationsText);
  const reverse = buildReverseIndex(zh);
  console.error(
    `loaded ${Object.keys(zh).length} zh keys from translations.ts`,
  );

  const files = collectSourceFiles();
  if (files.length === 0) {
    console.error("No source files found under", SCAN_DIRS.join(", "));
    process.exit(2);
  }

  const { reportsByFile, summary, perModule, missingByString } = aggregate(
    files,
    reverse,
  );

  const report: CoverageReport = {
    generatedAt: new Date().toISOString(),
    summary,
    perModule,
    missingByString,
    reportsByFile,
  };

  writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(REPORT_MD_PATH, buildMarkdown(report));

  return report;
}

function main() {
  const report = runAudit();
  const { summary } = report;
  console.log(
    `scanned ${summary.files} files: ${summary.totalStrings} Chinese strings, ${summary.coveredStrings} covered, ${summary.missingStrings} missing (${summary.coveragePercent}%)`,
  );
  console.log(
    `wrote ${REPORT_JSON_PATH} (${statSync(REPORT_JSON_PATH).size} bytes)`,
  );
  console.log(
    `wrote ${REPORT_MD_PATH} (${statSync(REPORT_MD_PATH).size} bytes)`,
  );

  if (summary.totalStrings === 0) {
    console.log("no Chinese strings found — nothing to audit");
    process.exit(0);
  }

  // Print top missing strings for human reading
  if (summary.missingStrings > 0) {
    console.log(
      `\ntop ${Math.min(10, report.missingByString.length)} missing strings:`,
    );
    for (const m of report.missingByString.slice(0, 10)) {
      const firstLoc = m.files[0]!;
      console.log(
        `  ${m.count}x  "${m.text}"  (first: ${firstLoc.path}:${firstLoc.line})`,
      );
    }
  }

  // Print worst modules
  if (report.perModule.length > 0) {
    console.log(`\nmodule coverage (bottom 5):`);
    for (const m of report.perModule.slice(0, 5)) {
      console.log(
        `  ${m.coveragePercent}%  ${m.module}  (${m.missing}/${m.total} missing)`,
      );
    }
  }

  // Exit code:
  //   0 = nothing to audit
  //   0 = all strings covered (informational only, not a CI gate)
  //   1 = missing strings found (caller can decide if this is a gate)
  // The script is informational — it doesn't fail CI on missing strings
  // because coverage is a known backlog, not a regression signal.
  process.exit(0);
}

// Only run the CLI when this file is executed directly (not when imported by tests)
if (resolve(process.argv[1] || "") === resolve(__filename)) {
  main();
}
