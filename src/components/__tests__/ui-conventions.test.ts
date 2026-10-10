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
 *   - "+ " is not part of a label — create buttons take a Plus icon;
 *   - headings take a .ui-title-* level instead of hand-picked sizes;
 *   - fields use UI_INPUT, buttons and button-styled links use ActionButton /
 *     ButtonLink / Chip / SegmentedControl, surfaces use data-card /
 *     data-inset / data-tile / data-popover — never pasted border+bg+radius;
 *   - content dialogs use <Dialog> / <ConfirmDialog>, confirmations never
 *     use window.confirm.
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
/** The primitives that legitimately own ModalShell. */
const MODAL_SHELL_ALLOWED = new Set([
	"components/ui/dialog.tsx",
	"components/confirm-dialog.tsx",
	"components/global-search.tsx",
	"app/files/preview/diff-review-dialog.tsx",
]);
/** Headings outside the type scale: the login hero and the dependency-free global error page. */
const HEADING_SCALE_EXEMPT = new Set(["app/login/page.tsx", "app/global-error.tsx"]);
/**
 * Files whose bespoke controls are intentional: the shared primitives
 * themselves, the command palette and top-bar search field, tree rows, chat
 * bubbles and avatars, media overlays, and the SSH terminal workspace (its own
 * dark chrome, reviewed separately).
 */
const CHROME_EXEMPT = new Set([
	"components/ui-primitives.tsx",
	"components/page-shell.tsx",
	"components/action-button.tsx",
	"components/modal-shell.tsx",
	"components/global-search.tsx",
	"components/app-topbar.tsx",
	"components/app-sidebar.tsx",
	"components/user-menu.tsx",
	"components/skip-link.tsx",
	"components/password-field.tsx",
	"components/pwa-register.tsx",
	"app/ai/ai-message-list.tsx",
	"app/ai/ai-sidebar.tsx",
	"app/ai/ai-attachments-preview.tsx",
	"app/ai/ai-empty-state.tsx",
	"app/api-docs/api-docs-page-client.tsx",
	"app/files/files-browser-sidebar.tsx",
	"app/files/file-list-details-view.tsx",
	"app/media/media-item-cover.tsx",
	"app/settings/settings-section.tsx",
	"app/login/page.tsx",
]);
const isSshWorkspace = (file: string) => /^components\/ssh-/.test(file);
const SIZE_UTILITY = /(?:^|\s)(?:sm:|md:|lg:)?text-(?:xs|sm|base|lg|xl|[2-6]xl|\[\d+(?:\.\d+)?px\])(?=\s|$)/;
const CHROME_RADIUS = /(?:^|\s)rounded-(?:md|lg|xl|2xl|3xl)(?=\s|$)/;
const CHROME_BORDER = /(?:^|\s)border(?=\s|$)/;
const CHROME_PADDING = /(?:^|\s)p[xy]?-\d/;
const SURFACE_BG = /bg-\[(?:var\(--(?:surface|surface-subtle|surface-elevated|input-bg|modal-bg)\)|color-mix)/;

function classNameOf(tag: string): string {
	return /\sclassName=(?:"([^"]*)"|\{([\s\S]*)\})/.exec(tag)?.slice(1).find(Boolean) ?? "";
}

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

	it("sizes headings with the .ui-title-* type scale", () => {
		const offenders: string[] = [];
		for (const { file, source } of tsxFiles) {
			if (HEADING_SCALE_EXEMPT.has(file)) continue;
			for (const level of ["h1", "h2", "h3", "h4"]) {
				for (const tag of openingTags(source, level)) {
					const className = classNameOf(tag);
					if (className.includes("sr-only")) continue;
					if (!className.includes("ui-title-") || SIZE_UTILITY.test(className)) offenders.push(`${file}: <${level} className="${className}">`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("styles fields with UI_INPUT", () => {
		const offenders: string[] = [];
		for (const { file, source } of tsxFiles) {
			if (CHROME_EXEMPT.has(file) || isSshWorkspace(file)) continue;
			for (const name of ["input", "select", "textarea"]) {
				for (const tag of openingTags(source, name)) {
					if (/type="(?:checkbox|radio|file|hidden|range|color)"/.test(tag)) continue;
					const className = classNameOf(tag);
					if (/UI_INPUT|ui-control|CONTROL_CLASS|inputClass|selectClass/.test(className)) continue;
					if (CHROME_BORDER.test(className) || CHROME_RADIUS.test(className) || /bg-\[var\(--input-bg\)\]/.test(className)) offenders.push(`${file}: <${name}>`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("uses the shared button components instead of hand-drawn buttons and links", () => {
		const offenders: string[] = [];
		for (const { file, source } of tsxFiles) {
			if (CHROME_EXEMPT.has(file) || isSshWorkspace(file)) continue;
			for (const name of ["button", "Link", "a"]) {
				for (const tag of openingTags(source, name)) {
					if (/data-(?:action-button|menu-item|chip|tile|inset|dropzone)/.test(tag)) continue;
					const className = classNameOf(tag);
					const drawn = CHROME_RADIUS.test(className) && CHROME_PADDING.test(className) && (CHROME_BORDER.test(className) || /bg-\[var\(--(?:color-action|accent-bg|danger-bg|warning-bg|success-bg)/.test(className));
					if (drawn) offenders.push(`${file}: <${name}>`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("draws surfaces with data-card / data-inset / data-tile / data-popover", () => {
		const offenders: string[] = [];
		for (const { file, source } of tsxFiles) {
			if (CHROME_EXEMPT.has(file) || isSshWorkspace(file)) continue;
			for (const match of source.matchAll(/<(\w+)\b[^<>]*?className=(?:"([^"]*)"|\{`([^`]*)`|\{cn\(\s*"([^"]*)")/g)) {
				const className = match[2] ?? match[3] ?? match[4] ?? "";
				if (CHROME_RADIUS.test(className) && CHROME_BORDER.test(className) && SURFACE_BG.test(className)) offenders.push(`${file}: <${match[1]}>`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("builds content dialogs on Dialog / ConfirmDialog", () => {
		const offenders = tsxFiles
			.filter(({ file, source }) => !MODAL_SHELL_ALLOWED.has(file) && /<ModalShell\b/.test(source))
			.map(({ file }) => file);
		expect(offenders).toEqual([]);
	});

	it("confirms in-app instead of with window.confirm", () => {
		const offenders = tsxFiles.filter(({ source }) => /window\.confirm\(/.test(source)).map(({ file }) => file);
		expect(offenders).toEqual([]);
	});

	it("keeps symbols out of translated labels", () => {
		const dictionaries = collectFiles(join(SRC_ROOT, "lib/i18n/dictionaries"), ".ts");
		const offenders = dictionaries.flatMap((file) =>
			[...readFileSync(file, "utf8").matchAll(/"([\w.-]+)": "(?:\+ |[←→] |[^"]* [←→]")/g)].map((match) => `${relative(SRC_ROOT, file)}: ${match[1]}`),
		);
		expect(offenders).toEqual([]);
	});
});
