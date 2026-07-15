/**
 * Smoke tests for the brand `--color-action` design tokens.
 *
 * Guards against accidental removal of the token system (it's the
 * source of truth for primary CTA color across the app).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("globals.css — action color tokens", () => {
	it("defines --color-action and friends on :root", () => {
		// dark theme block — :root contains the token declarations
		expect(css).toMatch(/--color-action:\s*#22d3ee/);
		expect(css).toMatch(/--color-action-hover:\s*#06b6d4/);
		expect(css).toMatch(/--color-action-bg:\s*rgba\(34,211,238/);
		expect(css).toMatch(/--color-action-border:\s*rgba\(34,211,238/);
	});

	it("overrides --color-action under html.light for contrast", () => {
		// light theme has cyan-700 (#0e7490) for readable contrast on pale canvas
		expect(css).toMatch(/--color-action:\s*#0e7490/);
	});

	it("ships the [data-action-button] utility rules", () => {
		expect(css).toMatch(/\[data-action-button\]\s*{/);
		expect(css).toMatch(/\[data-action-button\]\[data-variant="primary"\]/);
		expect(css).toMatch(/\[data-action-button\]\[data-variant="outline"\]/);
		expect(css).toMatch(/\[data-action-button\]\[data-variant="ghost"\]/);
		expect(css).toMatch(/\[data-action-button\]\[data-variant="success"\]/);
		expect(css).toMatch(/\[data-action-button\]\[data-variant="danger"\]/);
		expect(css).toMatch(/\[data-action-button\]\[data-variant="secondary"\]/);
	});

	it("uses var(--color-action) on the primary variant", () => {
		const primaryBlock = css.match(
			/\[data-action-button\]\[data-variant="primary"\][\s\S]*?\{[\s\S]*?\}/,
		);
		expect(primaryBlock).not.toBeNull();
		expect(primaryBlock?.[0]).toContain("var(--color-action)");
	});
});
