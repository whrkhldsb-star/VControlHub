/**
 * Every source file indents with one style. The code base grew with both
 * tabs and two-space indentation; mixing them inside one file is what makes
 * diffs noisy and editors reflow lines. New files follow the style of the
 * directory they live in; a file never mixes.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) sourceFiles(path, out);
		else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
	}
	return out;
}

type Range = { start: number; end: number };

/** Spans whose leading whitespace is content, not indentation: literals, JSX text and block comments. */
function protectedRanges(text: string, fileName: string): Range[] {
	const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
	const ranges: Range[] = [];
	const addComments = (comments: ts.CommentRange[] | undefined) => {
		for (const comment of comments ?? []) {
			if (comment.kind === ts.SyntaxKind.MultiLineCommentTrivia) ranges.push({ start: comment.pos, end: comment.end });
		}
	};
	// Comments live in the trivia before and after tokens; walk every token to find them.
	const visit = (node: ts.Node) => {
		addComments(ts.getLeadingCommentRanges(text, node.getFullStart()));
		addComments(ts.getTrailingCommentRanges(text, node.getEnd()));
		if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isStringLiteral(node) || ts.isJsxText(node)) {
			ranges.push({ start: node.getStart(source), end: node.getEnd() });
			return;
		}
		for (const child of node.getChildren(source)) visit(child);
	};
	visit(source);
	addComments(ts.getLeadingCommentRanges(text, source.endOfFileToken.getFullStart()));
	return ranges;
}

/** Counts tab- and space-indented lines, skipping lines that start inside `ranges`. */
function indentationStyles(text: string, ranges: Range[] = []): { tabs: number; spaces: number } {
	let tabs = 0;
	let spaces = 0;
	let offset = 0;
	for (const line of text.split("\n")) {
		const start = offset;
		offset += line.length + 1;
		if (ranges.some((range) => start > range.start && start < range.end)) continue;
		const match = /^([ \t]+)\S/.exec(line);
		if (!match) continue;
		if (match[1]!.startsWith("\t")) tabs++;
		else spaces++;
	}
	return { tabs, spaces };
}

describe("indentation consistency", () => {
	it("never mixes tabs and spaces for indentation inside one source file", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(ROOT)) {
			const text = readFileSync(file, "utf8");
			// Protected ranges only ever remove lines from the count, so a file whose raw lines
			// indent one way cannot mix. Only the rest need the (slow) TypeScript parse.
			const raw = indentationStyles(text);
			if (raw.tabs === 0 || raw.spaces === 0) continue;
			const { tabs, spaces } = indentationStyles(text, protectedRanges(text, file));
			if (tabs > 0 && spaces > 0) offenders.push(`${relative(ROOT, file)} (tabs ${tabs}, spaces ${spaces})`);
		}
		expect(offenders, "files mixing tab and space indentation").toEqual([]);
	});
});
