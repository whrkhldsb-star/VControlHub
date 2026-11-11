import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src/app");

function pages(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === "api" || name === "__tests__" ? [] : pages(path);
		return name === "page.tsx" ? [path] : [];
	});
}

/** The calls of a page's session guard, each with what it passes as the way back. */
function guardCalls(source: string): Array<{ call: string; returnsTo: string | null }> {
	const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
	const calls: Array<{ call: string; returnsTo: string | null }> = [];
	for (const match of code.matchAll(/requireSession\(([^)]*)\)/g)) {
		calls.push({ call: match[0], returnsTo: match[1]!.trim() || null });
	}
	for (const match of code.matchAll(/requirePagePermission\(\s*"[^"]+"\s*(?:,\s*\{([\s\S]*?)\})?\s*,?\s*\)/g)) {
		calls.push({ call: match[0].replace(/\s+/g, " "), returnsTo: /redirectTo\s*:/.test(match[1] ?? "") ? match[1]!.trim() : null });
	}
	return calls;
}

describe("page guards", () => {
	it("say where to come back to after signing in again", () => {
		// The guard sends a visitor whose session has ended to the sign-in page, and from there back to the path
		// it was given. Given none, that is the home page: seven pages (traffic, Docker, image bed, snippets,
		// AI operations, notifications, the file preview) lost their place this way.
		const missing = pages(APP).flatMap((file) =>
			guardCalls(readFileSync(file, "utf8"))
				.filter((guard) => guard.returnsTo === null)
				.map((guard) => `${relative(APP, file)}: ${guard.call}`),
		);
		expect(missing).toEqual([]);
	});

	it("finds the guards it is meant to check", () => {
		const guarded = pages(APP).filter((file) => guardCalls(readFileSync(file, "utf8")).length > 0);
		expect(guarded.length).toBeGreaterThan(35);
	});
});
