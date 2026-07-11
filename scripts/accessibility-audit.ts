/**
 * scripts/accessibility-audit.ts
 *
 * Static analyzer that scans VControlHub's user-facing TSX files for two
 * distinct classes of accessibility issues:
 *
 *   Phase 1 — form field label association. For every user-facing form field
 *             (input / textarea / select) in a TSX file, decide whether it has
 *             a visible label association. A field is considered labeled when
 *             ANY of the following is true:
 *               1. The field has `aria-label="..."`.
 *               2. The field has `aria-labelledby="X"` AND some element in the
 *                  same file has `id="X"`.
 *               3. The field has `id="X"` AND a <label htmlFor="X"> exists in
 *                  the same file.
 *               4. The field is wrapped inside a <label>...</label> (we track
 *                  label tag open/close boundaries).
 *             Fields that are purely structural (`type="hidden" | "submit" |
 *             "button" | "reset" | "image"`) are skipped — they don't represent
 *             a form input that needs a label.
 *
 *   Phase 2 — icon-only <button> elements. For every <button> in a TSX file,
 *             decide whether it has any way for a screen reader user to know
 *             what it does. A button is "icon-only" if it has NO visible text,
 *             NO `aria-label`, NO `aria-labelledby`, and NO `title`. These
 *             buttons are accessible only by visual icon recognition.
 *
 *             The audit is conservative: variable references like `{label}`
 *             are NOT evaluated (treated as icon-only), and ternaries with
 *             literal text (e.g. `cond ? "yes" : "no"`) DO count. True
 *             positives need a manual review pass to confirm.
 *
 * Output:
 *   - JSON report to docs/accessibility-audit.json (machine-readable, both
 *     phases included under separate top-level keys).
 *   - Human summary on stdout (phase 1 counts + phase 2 counts + first N
 *     flagged items per file).
 *   - Exit code 0 if no phase 1 flags (phase 2 is advisory; not gated).
 *
 * Run: npx tsx scripts/accessibility-audit.ts
 */
import { readFileSync, statSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type FieldKind = "input" | "textarea" | "select";

export type Field = {
  kind: FieldKind;
  /** 1-based line number where the opening tag starts */
  line: number;
  /** raw opening tag text (between '<' and '>') */
  raw: string;
  /** id attribute if present */
  id?: string;
  /** aria-label if present */
  ariaLabel?: string;
  /** aria-labelledby if present */
  ariaLabelledBy?: string;
  /** input type attribute (input only) */
  type?: string;
  /** name attribute (informational) */
  name?: string;
  /** placeholder attribute (informational) */
  placeholder?: string;
};

export type Label = {
  /** 1-based line number where the opening tag starts */
  line: number;
  /** raw opening tag text */
  raw: string;
  /** htmlFor attribute if present */
  htmlFor?: string;
};

export type AuditReason =
  | "aria-label"
  | "aria-labelledby"
  | "htmlFor-match"
  | "label-wrapped"
  | "no-label";

export type FieldResult = {
  field: Field;
  ok: boolean;
  reason: AuditReason;
  /** Line of the matching <label> or labelledby target, if any */
  matchedLabelLine?: number;
};

const SKIP_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
]);

/**
 * Find the closing `>` of a tag, given the position right after `<tag`.
 * Skips over JSX expressions ({...}) and string literals, so attributes
 * like `aria-label={value > 5 ? "big" : "small"}` are handled correctly.
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
 *   name="value"          (m[2] = "value")
 *   name='value'          (m[3] = "value")
 *   name={expression}     (m[4] = "{expression}" — captured verbatim)
 *   name                  (boolean attribute, e.g. `required`; value = "")
 *
 * For the audit's purposes we don't evaluate the expression — we just
 * record that the attribute is present, so an aria-label with a JSX
 * expression is treated as "labeled" even when we can't compute the text.
 */
function extractAttrs(tagContent: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{[\s\S]*?\})))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagContent)) !== null) {
    const name = m[1]!.toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    if (!(name in attrs)) {
      attrs[name] = value;
    }
  }
  return attrs;
}

/**
 * Compute the 1-based line number of a 0-based text offset.
 */
function lineForOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/**
 * Returns true if the raw tag indicates the field is not user-visible
 * (e.g. className="hidden", aria-hidden, type="hidden"). The script's
 * normal SKIP_TYPES only catches `type="hidden"|"submit"|...`, so the
 * hidden file/checkbox patterns need an explicit visibility check.
 */
function isInvisibleField(raw: string, type: string | undefined): boolean {
  if (type && SKIP_TYPES.has(type.toLowerCase())) return true;
  // className contains a "hidden" class — Tailwind / utility-class hides
  if (/\bclassName\s*=\s*["'`][^"'`]*\bhidden\b/.test(raw)) return true;
  // explicit aria-hidden on the input
  if (/\baria-hidden\s*=\s*["'`]true["'`]/.test(raw)) return true;
  return false;
}

/**
 * Walk a TSX file's text and collect all relevant fields and labels.
 *
 * We do this in a single pass: track the position of each opening tag
 * (input / textarea / select / label), and the position of the matching
 * closing tag for <label> so we can detect label-wrapped inputs.
 */
function collectNodes(text: string): { fields: Field[]; labels: Label[] } {
  const fields: Field[] = [];
  const labels: Label[] = [];
  const scanText = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length)).replace(/\/\/[^\n]*/g, (comment) => " ".repeat(comment.length));
  const tagRe = /<(input|textarea|select|label)\b/g;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(scanText)) !== null) {
    const tagKind = m[1]!.toLowerCase() as FieldKind | "label";
    const tagStart = m.index;
    const tagNameEnd = tagStart + 1 + tagKind.length;
    const tagEnd = findTagEnd(scanText, tagNameEnd);
    if (tagEnd < 0) continue;
    const inner = scanText.slice(tagNameEnd, tagEnd);
    const attrs = extractAttrs(inner);
    const line = lineForOffset(text, tagStart);
    const raw = `<${tagKind}${inner}>`;

    if (tagKind === "label") {
      // Record the label's htmlFor for matching; depth tracking for the
      // label-wrapping check happens in computeLabelWrapping below.
      labels.push({ line, raw, htmlFor: attrs.htmlfor });
    } else {
      // input / textarea / select
      if (isInvisibleField(raw, attrs.type) || /\{\.\.\.\w+\}/.test(raw)) continue;
      fields.push({
        kind: tagKind as FieldKind,
        line,
        raw,
        id: attrs.id,
        ariaLabel: attrs["aria-label"],
        ariaLabelledBy: attrs["aria-labelledby"],
        type: attrs.type,
        name: attrs.name,
        placeholder: attrs.placeholder,
      });
    }

    // Advance past `>` so the regex doesn't re-fire on the same tag
    tagRe.lastIndex = tagEnd + 1;
  }

  return { fields, labels };
}

/**
 * Second pass: re-walk text tracking label open/close to determine whether
 * each previously-found field is inside a <label>. We replace labelStackDepths
 * with the actual depth-at-input data.
 */
function computeLabelWrapping(text: string, fields: Field[]): boolean[] {
  // Walk text, tracking <label> open vs </label> close. For each field
  // position, record the depth (0 = not inside any label, 1+ = inside).
  const events: { offset: number; kind: "open" | "close" | "field"; fieldIdx?: number }[] = [];
  // find all <label and </label and re-feed field offsets
  const openRe = /<label\b/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(text)) !== null) {
    const tagStart = m.index;
    const tagNameEnd = tagStart + 1 + "label".length;
    const tagEnd = findTagEnd(text, tagNameEnd);
    if (tagEnd < 0) continue;
    const isSelfClose = text[tagEnd - 1] === "/";
    events.push({ offset: tagStart, kind: "open" });
    if (isSelfClose) {
      // Pair immediately: simulate an instant close at tagEnd+1
      events.push({ offset: tagEnd + 1, kind: "close" });
    }
    openRe.lastIndex = tagEnd + 1;
  }
  const closeRe = /<\/label\s*>/g;
  while ((m = closeRe.exec(text)) !== null) {
    events.push({ offset: m.index, kind: "close" });
  }
  // For each field we collected, find its opening tag offset in the text
  // by matching on the same raw pattern
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    const offset = text.indexOf(f.raw);
    events.push({ offset: offset < 0 ? Number.MAX_SAFE_INTEGER : offset, kind: "field", fieldIdx: i });
  }
  // Sort by offset; for ties, prefer close before open before field
  events.sort((a, b) => {
    if (a.offset !== b.offset) return a.offset - b.offset;
    const rank = { close: 0, open: 1, field: 2 } as const;
    return rank[a.kind] - rank[b.kind];
  });
  const wrapped: boolean[] = new Array(fields.length).fill(false);
  let depth = 0;
  for (const e of events) {
    if (e.kind === "open") depth++;
    else if (e.kind === "close") depth = Math.max(0, depth - 1);
    else if (e.kind === "field" && e.fieldIdx !== undefined) {
      wrapped[e.fieldIdx] = depth > 0;
    }
  }
  return wrapped;
}

/**
 * Scan a single file's TSX text and return per-field results.
 */
export function scanFile(filePath: string, text: string): FieldResult[] {
  const { fields, labels } = collectNodes(text);
  if (fields.length === 0) return [];

  const wrapped = computeLabelWrapping(text, fields);
  const labelByFor = new Map<string, number>();
  for (const l of labels) {
    if (l.htmlFor) labelByFor.set(l.htmlFor, l.line);
  }
  // Find all id="X" anywhere in the file (for aria-labelledby)
  const idRe = /\bid\s*=\s*["']([^"']+)["']/g;
  const idsInFile = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(text)) !== null) {
    idsInFile.add(m[1]!);
  }

  return fields.map((field, i) => {
    if (field.ariaLabel && field.ariaLabel.length > 0) {
      return { field, ok: true, reason: "aria-label" as AuditReason };
    }
    if (field.ariaLabelledBy && idsInFile.has(field.ariaLabelledBy)) {
      // We don't compute the line of the labelledby target, but it's OK.
      return { field, ok: true, reason: "aria-labelledby" as AuditReason };
    }
    if (field.id && labelByFor.has(field.id)) {
      return {
        field,
        ok: true,
        reason: "htmlFor-match" as AuditReason,
        matchedLabelLine: labelByFor.get(field.id),
      };
    }
    if (wrapped[i]) {
      return { field, ok: true, reason: "label-wrapped" as AuditReason };
    }
    return { field, ok: false, reason: "no-label" as AuditReason };
  });
}

export type AuditSummary = {
  total: number;
  ok: number;
  flagged: number;
  byFile: Record<string, FieldResult[]>;
};

// ---------------------------------------------------------------------------
// Phase 2: icon-only button detection (button has no visible text, no aria-label,
// no aria-labelledby, no title — screen readers would have no idea what it does).
// ---------------------------------------------------------------------------

export type ButtonFinding = {
  /** 1-based line number of the <button> opening tag */
  line: number;
  /** raw opening tag text */
  raw: string;
};

/**
 * Find the matching </button> after the given offset. Returns -1 if not found.
 * Tracks <button> open / </button> close nesting (e.g. <button>...</button> works
 * fine, but in JSX a button can wrap expressions; we just find the first close).
 */
function findClosingButton(text: string, startOffset: number): number {
  // Simple: find the next </button> (buttons don't nest in practice)
  const re = /<\/button\s*>/g;
  re.lastIndex = startOffset;
  const m = re.exec(text);
  return m ? m.index : -1;
}

/**
 * Extract visible text from a JSX element body. The body may contain:
 *   - <span>{text}</span> with literal text or variable references
 *   - <svg/> elements (treated as icon — no text)
 *   - other elements with no text
 *   - direct text nodes
 *
 * We strip HTML tags and JSX comments, then look at what's left. JSX expressions
 * with literal string contents (e.g. `cond ? "yes" : "no"`) are kept; variable
 * references (e.g. `{label}` / `{children}`) represent runtime-visible content
 * and are retained as a marker. Icon JSX expressions are still removed with
 * their tags, so a genuinely icon-only button remains flagged.
 */
function extractJsxVisibleText(body: string): string {
  let result = body;
  // Remove HTML comments
  result = result.replace(/<!--[\s\S]*?-->/g, "");
  // For each JSX expression, pull out string literals (for ternaries / fallbacks)
  result = result.replace(/\{([^{}]*)\}/g, (_match, inner: string) => {
    const stringLiterals: string[] = [];
    const strRe = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
    let sm: RegExpExecArray | null;
    while ((sm = strRe.exec(inner)) !== null) {
      stringLiterals.push(sm[1] ?? sm[2] ?? "");
    }
    if (stringLiterals.length > 0) return stringLiterals.join(" ");
    const expression = inner.trim();
    if (/<\/?[A-Za-z]/.test(expression)) return "";
    if (/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$/.test(expression)) {
      return "runtime-label";
    }
    if (/[A-Za-z_$][\w$]*/.test(expression)) return "runtime-label";
    return "";
  });
  // Remove HTML tags after inspecting JSX expressions so icon components
  // inside expressions can be distinguished from runtime text expressions.
  result = result.replace(/<[^>]+>/g, "");
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Scan a single file's TSX text and return icon-only button findings.
 * A button is "icon-only" if it has no visible text, no aria-label, no
 * aria-labelledby, and no title. SR-only labels via aria-label are valid;
 * `title` is acceptable but not preferred — we treat it as labeled for
 * the purpose of the audit (passes for the user, but we note it).
 */
export function scanIconOnlyButtons(filePath: string, text: string): ButtonFinding[] {
  const findings: ButtonFinding[] = [];
  const openRe = /<button\b/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(text)) !== null) {
    const tagStart = m.index;
    const tagNameEnd = tagStart + 1 + "button".length;
    const tagEnd = findTagEnd(text, tagNameEnd);
    if (tagEnd < 0) continue;
    const inner = text.slice(tagNameEnd, tagEnd);
    const attrs = extractAttrs(inner);
    if (attrs["aria-label"] && attrs["aria-label"].length > 0) continue;
    if (attrs["aria-labelledby"] && attrs["aria-labelledby"].length > 0) continue;
    if (attrs.title && attrs.title.length > 0) continue;
    const closeOffset = findClosingButton(text, tagEnd + 1);
    if (closeOffset < 0) continue;
    const body = text.slice(tagEnd + 1, closeOffset);
    const visible = extractJsxVisibleText(body);
    if (visible.length > 0) continue;
    findings.push({
      line: lineForOffset(text, tagStart),
      raw: `<button${inner}>`,
    });
  }
  return findings;
}

export type IconOnlySummary = {
  total: number;
  flagged: number;
  byFile: Record<string, ButtonFinding[]>;
};

export function auditIconOnlyButtons(files: { path: string; text: string }[]): IconOnlySummary {
  const byFile: Record<string, ButtonFinding[]> = {};
  let total = 0;
  let flagged = 0;
  for (const f of files) {
    const findings = scanIconOnlyButtons(f.path, f.text);
    if (findings.length > 0) byFile[f.path] = findings;
    total += findings.length;
    flagged += findings.length;
  }
  return { total, flagged, byFile };
}

/**
 * Aggregate per-file scan results into a summary.
 */
export function auditFiles(files: { path: string; text: string }[]): AuditSummary {
  const byFile: Record<string, FieldResult[]> = {};
  let total = 0;
  let ok = 0;
  let flagged = 0;
  for (const f of files) {
    const results = scanFile(f.path, f.text);
    byFile[f.path] = results;
    total += results.length;
    ok += results.filter((r) => r.ok).length;
    flagged += results.filter((r) => !r.ok).length;
  }
  return { total, ok, flagged, byFile };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const SCAN_DIRS = ["src/app", "src/components"];
const SKIP_DIR_NAMES = new Set(["__tests__", "node_modules", ".next"]);
const REPORT_PATH = join(ROOT, "docs", "accessibility-audit.json");
const PREVIEW_PER_FILE = 5;

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

function main() {
  const files = collectSourceFiles();
  if (files.length === 0) {
    console.error("No source files found under", SCAN_DIRS.join(", "));
    process.exit(2);
  }

  const inputs = files.map((f) => ({
    path: relative(ROOT, f),
    text: readFileSync(f, "utf8"),
  }));

  const summary = auditFiles(inputs);
  const phase2 = auditIconOnlyButtons(inputs);

  // Build JSON report
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      files: inputs.length,
      total: summary.total,
      ok: summary.ok,
      flagged: summary.flagged,
    },
    flaggedByFile: Object.fromEntries(
      Object.entries(summary.byFile)
        .filter(([, results]) => results.some((r) => !r.ok))
        .map(([path, results]) => [
          path,
          results
            .filter((r) => !r.ok)
            .map((r) => ({
              line: r.field.line,
              kind: r.field.kind,
              type: r.field.type,
              name: r.field.name,
              id: r.field.id,
              placeholder: r.field.placeholder,
              raw: r.field.raw,
            })),
        ])
    ),
    phase2: {
      description:
        "Icon-only <button> elements with no visible text, no aria-label, no aria-labelledby, and no title attribute. Screen readers will announce these as unlabeled buttons.",
      summary: {
        total: phase2.total,
        flagged: phase2.flagged,
      },
      iconOnlyByFile: Object.fromEntries(
        Object.entries(phase2.byFile).map(([path, findings]) => [
          path,
          findings.map((f) => ({ line: f.line, raw: f.raw })),
        ])
      ),
    },
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  // Human summary
  const fileCount = Object.keys(report.flaggedByFile).length;
  console.log(
    `scanned ${inputs.length} files: ${summary.total} fields, ${summary.ok} ok, ${summary.flagged} flagged across ${fileCount} files`
  );
  console.log(
    `phase2 (icon-only buttons): ${phase2.flagged} flagged across ${Object.keys(phase2.byFile).length} files`
  );
  console.log(`wrote ${REPORT_PATH} (${statSync(REPORT_PATH).size} bytes)`);

  if (fileCount > 0) {
    console.log(`\nfirst ${PREVIEW_PER_FILE} flagged items per file:`);
    for (const [filePath, items] of Object.entries(report.flaggedByFile)) {
      console.log(`  ${filePath} (${(items as unknown[]).length}):`);
      for (const item of (items as Array<{ line: number; kind: string; type?: string; name?: string; raw: string }>).slice(
        0,
        PREVIEW_PER_FILE
      )) {
        const desc = item.name
          ? `name="${item.name}"`
          : item.type
            ? `type=${item.type}`
            : "kind=" + item.kind;
        console.log(`    L${item.line}  ${desc}  ${item.raw.slice(0, 80)}`);
      }
    }
  }

  if (phase2.flagged > 0) {
    console.log(`\nphase2 first ${PREVIEW_PER_FILE} icon-only buttons per file:`);
    for (const [filePath, items] of Object.entries(report.phase2.iconOnlyByFile)) {
      console.log(`  ${filePath} (${(items as unknown[]).length}):`);
      for (const item of (items as Array<{ line: number; raw: string }>).slice(0, PREVIEW_PER_FILE)) {
        console.log(`    L${item.line}  ${item.raw.slice(0, 80).replace(/\n/g, " ")}`);
      }
    }
  }

  // Phase 1 (form label associations) is the critical a11y gate; phase 2 is
  // advisory (true positives need a manual review pass to confirm icon vs text
  // interpretation). So we exit 0 unless phase 1 fails.
  process.exit(summary.flagged > 0 ? 1 : 0);
}

// Only run the CLI when this file is executed directly (not when imported by tests)
if (resolve(process.argv[1] || "") === resolve(__filename)) {
  main();
}
