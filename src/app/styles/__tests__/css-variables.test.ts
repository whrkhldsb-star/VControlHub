import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
		return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
	});
}

describe("CSS variables", () => {
	it("are defined wherever a class or a rule reads one", () => {
		// `text-[var(--warn)]` and `focus:ring-[var(--accent-ring)]` compiled and rendered: an undefined variable is
		// not an error, the declaration is dropped, so a warning line had the body colour and a checkbox no focus ring.
		const files = sourceFiles(ROOT);
		const defined = new Set<string>();
		for (const file of files) {
			const text = readFileSync(file, "utf8");
			// In a stylesheet, set from script ("--x": value, setProperty("--x", …)) or as an arbitrary property ([--x:1]).
			const patterns = file.endsWith(".css")
				? [/(--[A-Za-z0-9_-]+)\s*:/g]
				: [/["'](--[A-Za-z0-9_-]+)["']\s*[:,]/g, /setProperty\(\s*["'](--[A-Za-z0-9_-]+)/g, /\[(--[A-Za-z0-9_-]+):/g];
			for (const pattern of patterns) for (const match of text.matchAll(pattern)) defined.add(match[1]!);
		}
		const undefinedUses: string[] = [];
		for (const file of files) {
			for (const match of readFileSync(file, "utf8").matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
				if (!defined.has(match[1]!)) undefinedUses.push(`${match[1]} in ${file.slice(ROOT.length + 1)}`);
			}
		}
		expect(undefinedUses).toEqual([]);
	});
});
