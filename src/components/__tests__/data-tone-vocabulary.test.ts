import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `globals.css` defines `--tone-bg` for these seven hue names only, and the sole
 * rule that consumes it is `:root [data-tone] { background-color: var(--tone-bg) }`.
 * A `data-tone="warning"` therefore resolves to an undefined variable and paints
 * nothing — which is how the users page shipped four differently-labelled buttons
 * that all rendered as the same colourless outline, and how the operation-task
 * list rendered six statuses identically.
 *
 * Semantic tones belong to `StatusBadge` / `Notice` / `ActionButton`, which set
 * their colours through classes.
 */
const VALID_TONES = new Set([
	"cyan",
	"emerald",
	"rose",
	"amber",
	"sky",
	"blue",
	"violet",
]);

const SRC_ROOT = join(process.cwd(), "src");

function collectTsxFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry === ".next") continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) collectTsxFiles(path, out);
		else if (entry.endsWith(".tsx")) out.push(path);
	}
	return out;
}

/** Drop comments so prose that quotes the broken pattern is not flagged. */
function stripComments(source: string): string {
	return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "");
}

describe("data-tone vocabulary", () => {
	it("only uses hue names globals.css actually defines", () => {
		const offenders: string[] = [];
		for (const file of collectTsxFiles(SRC_ROOT)) {
			const source = stripComments(readFileSync(file, "utf8"));
			for (const match of source.matchAll(/data-tone="([^"]*)"/g)) {
				const tone = match[1]!;
				if (!VALID_TONES.has(tone)) {
					offenders.push(`${file.slice(SRC_ROOT.length + 1)}: data-tone="${tone}"`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
