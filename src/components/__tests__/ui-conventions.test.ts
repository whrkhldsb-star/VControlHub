import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards for the shared UI system (docs/ui-system.md). Each rule exists
 * because the pattern it forbids was pasted into dozens of files before the
 * shared primitive existed, and every copy drifted a little:
 *
 *   - button sizes come from `size` / `square`, not `!px-3 !py-1.5 !text-sm`;
 *   - links that look like buttons are <ButtonLink>, not <Link data-action-button>;
 *   - dialogs get their overlay and panel from ModalShell's size/placement;
 *   - "+ " is not part of a label — create buttons take a Plus icon.
 *
 * Allowlists name the few places that genuinely need bespoke chrome.
 */
const SRC_ROOT = join(process.cwd(), "src");

function collectFiles(dir: string, suffix: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) collectFiles(path, suffix, out);
		else if (entry.endsWith(suffix)) out.push(path);
	}
	return out;
}

function stripComments(source: string): string {
	return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Opening tags `<Name …>` with attribute expressions balanced. */
function openingTags(source: string, name: string): string[] {
	const tags: string[] = [];
	const pattern = new RegExp(`<${name}(?=[\\s/>])`, "g");
	for (const match of source.matchAll(pattern)) {
		let depth = 0;
		let quote: string | null = null;
		for (let index = match.index + name.length + 1; index < source.length; index++) {
			const char = source[index]!;
			if (quote) {
				if (char === quote) quote = null;
				continue;
			}
			if (char === "{") depth++;
			else if (char === "}") depth--;
			else if (depth > 0 && (char === '"' || char === "'" || char === "`")) quote = char;
			else if (depth === 0 && char === '"') quote = char;
			else if (char === ">" && depth === 0) {
				tags.push(source.slice(match.index, index + 1));
				break;
			}
		}
	}
	return tags;
}

const tsxFiles = collectFiles(SRC_ROOT, ".tsx").map((file) => ({
	// Normalize to forward slashes so allowlists match on both POSIX and Windows.
	file: relative(SRC_ROOT, file).split(/[\\/]/).join("/"),
	source: stripComments(readFileSync(file, "utf8")),
}));

const BUTTON_SIZE_OVERRIDE = /(^|\s)!(px|py|text|min-h|h|rounded)-/;
/** List-row buttons in the terminal side panel and share picker are styled as rows, not buttons. */
const BUTTON_OVERRIDE_ALLOWED = new Set([
	"components/ssh-terminal-side-panel.tsx",
	"app/shares/share-file-picker.tsx",
]);
/** The command palette and the inline diff review keep bespoke chrome. */
const CUSTOM_DIALOG_ALLOWED = new Set(["components/global-search.tsx", "app/files/preview/diff-review-dialog.tsx"]);
/** Mobile navigation drawers and the palette own their overlays. */
const CUSTOM_OVERLAY_ALLOWED = new Set([
	"components/modal-shell.tsx",
	"components/app-sidebar.tsx",
	"components/global-search.tsx",
	"app/ai/ai-sidebar.tsx",
]);

describe("UI conventions", () => {
	it("sizes buttons with the size prop instead of !important overrides", () => {
		const offenders: string[] = [];
		for (const { file, source } of tsxFiles) {
			if (BUTTON_OVERRIDE_ALLOWED.has(file)) continue;
			for (const name of ["ActionButton", "Button", "ButtonLink"]) {
				for (const tag of openingTags(source, name)) {
					const className = /\sclassName="([^"]*)"/.exec(tag)?.[1];
					if (className && BUTTON_SIZE_OVERRIDE.test(className)) offenders.push(`${file}: ${className}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("renders button-styled links with ButtonLink", () => {
		const offenders = tsxFiles.flatMap(({ file, source }) =>
			openingTags(source, "Link")
				.filter((tag) => tag.includes("data-action-button"))
				.map(() => file),
		);
		expect(offenders).toEqual([]);
	});

	it("styles dialogs through ModalShell size and placement", () => {
		const offenders = tsxFiles.flatMap(({ file, source }) =>
			CUSTOM_DIALOG_ALLOWED.has(file)
				? []
				: openingTags(source, "ModalShell")
						.filter((tag) => /\s(overlayClassName|panelClassName)=/.test(tag))
						.map(() => file),
		);
		expect(offenders).toEqual([]);
	});

	it("does not hand-roll modal overlays", () => {
		const offenders = tsxFiles
			.filter(({ file, source }) => !CUSTOM_OVERLAY_ALLOWED.has(file) && /fixed inset-0[^"`]*bg-\[var\(--overlay/.test(source))
			.map(({ file }) => file);
		expect(offenders).toEqual([]);
	});

	it("drops the legacy data-primary attribute", () => {
		const offenders = tsxFiles.filter(({ source }) => /\sdata-primary(?=[\s>/])/.test(source)).map(({ file }) => file);
		expect(offenders).toEqual([]);
	});

	it("keeps symbols out of translated labels", () => {
		const dictionaries = collectFiles(join(SRC_ROOT, "lib/i18n/dictionaries"), ".ts");
		const offenders = dictionaries.flatMap((file) =>
			[...readFileSync(file, "utf8").matchAll(/"([\w.-]+)": "\+ /g)].map((match) => `${relative(SRC_ROOT, file)}: ${match[1]}`),
		);
		expect(offenders).toEqual([]);
	});
});
