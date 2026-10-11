/**
 * Normalise mixed indentation per file: lines whose indentation style is the
 * minority (tabs vs spaces) are rewritten in the file's dominant style.
 * Lines inside template literals, block comments spanning lines are left as
 * they are (their leading whitespace can be content).
 *
 * Usage: npm run indent:fix -- [--check] <file...>
 * The guard `src/__tests__/indentation-consistency.test.ts` fails on files that mix styles.
 */
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

type Range = { start: number; end: number };

function protectedRanges(text: string, fileName: string): Range[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const ranges: Range[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) ||
      ts.isStringLiteral(node) ||
      ts.isJsxText(node)
    ) {
      ranges.push({ start: node.getStart(source), end: node.getEnd() });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  // Multi-line comments: scan trivia.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  scanner.setText(text);
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.MultiLineCommentTrivia) {
      ranges.push({ start: scanner.getTokenPos(), end: scanner.getTextPos() });
    }
    token = scanner.scan();
  }
  return ranges;
}

function lineStartOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") offsets.push(i + 1);
  return offsets;
}

export function normalise(text: string, fileName: string): { text: string; changed: number; style: "tab" | "space"; width: number } | null {
  const lines = text.split("\n");
  const offsets = lineStartOffsets(text);
  const ranges = protectedRanges(text, fileName);
  const protectedLine = (index: number) => {
    const start = offsets[index]!;
    // A line is protected when its start lies strictly inside a protected range
    // (the first line of a template starts outside it).
    return ranges.some((range) => start > range.start && start < range.end);
  };
  let tabLines = 0;
  let spaceLines = 0;
  const spaceWidths = new Map<number, number>();
  lines.forEach((line, index) => {
    if (protectedLine(index)) return;
    const match = /^([ \t]+)\S/.exec(line);
    if (!match) return;
    const indent = match[1]!;
    if (indent.includes("\t")) tabLines++;
    else {
      spaceLines++;
      spaceWidths.set(indent.length, (spaceWidths.get(indent.length) ?? 0) + 1);
    }
  });
  if (tabLines === 0 || spaceLines === 0) return null;
  const style: "tab" | "space" = tabLines >= spaceLines ? "tab" : "space";
  // Space width: 2 unless every space-indented line is a multiple of 4 and some are not multiples of 2... keep it simple: 2 when any odd multiple of 2 exists, else 4.
  const widths = [...spaceWidths.keys()];
  const width = widths.some((w) => w % 4 !== 0) ? 2 : 4;
  let changed = 0;
  const out = lines.map((line, index) => {
    if (protectedLine(index)) return line;
    const match = /^([ \t]+)(\S.*)?$/.exec(line);
    if (!match || match[2] === undefined) return line;
    const indent = match[1]!;
    const rest = match[2];
    if (style === "tab") {
      if (!indent.includes(" ")) return line;
      // Convert leading spaces (possibly mixed with tabs) to tabs; a trailing partial group stays as spaces (continuation alignment).
      let tabs = 0;
      let spaces = 0;
      for (const ch of indent) {
        if (ch === "\t") { tabs += 1 + Math.floor(spaces / width); spaces = 0; }
        else spaces++;
      }
      tabs += Math.floor(spaces / width);
      const remainder = spaces % width;
      const next = "\t".repeat(tabs) + " ".repeat(remainder) + rest;
      if (next !== line) changed++;
      return next;
    }
    if (!indent.includes("\t")) return line;
    const next = indent.replace(/\t/g, " ".repeat(width)) + rest;
    if (next !== line) changed++;
    return next;
  });
  return { text: out.join("\n"), changed, style, width };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""))) {
  const check = process.argv.includes("--check");
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  let total = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const result = normalise(text, file);
    if (!result || result.changed === 0) continue;
    total += result.changed;
    console.log(`${file}: ${result.changed} lines -> ${result.style}${result.style === "space" ? result.width : ""}`);
    if (!check) writeFileSync(file, result.text);
  }
  console.log(`total changed lines: ${total}`);
}
