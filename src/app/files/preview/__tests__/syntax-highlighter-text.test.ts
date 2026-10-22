import { describe, expect, it } from "vitest";

import { highlightLine } from "../syntax-highlighter";
import { highlightSearchTerm } from "../text-preview-highlight";

/** What the preview shows as text: the line with every tag stripped. */
function visible(html: string) {
	const element = document.createElement("div");
	element.innerHTML = html;
	return element.textContent;
}

/**
 * Highlighting must not change the text of the line. Rules ran over the
 * HTML built so far: the keyword rule matched the comment span's "class"
 * attribute, and searching for "class" did too, so markup leaked into the
 * visible text.
 */
describe("preview highlighting keeps the line's text", () => {
	it.each([
		["typescript", "// ordinary note"],
		["python", "# ordinary note"],
		["typescript", "const value = 1; // class of its own"],
		["python", "class Repo:  # the class"],
	])("%s: %s", (lang, line) => {
		expect(visible(highlightLine(line, lang))).toBe(line);
	});

	it("searches the text, not the tags", () => {
		const html = highlightLine("const value = 1;", "typescript");
		expect(visible(highlightSearchTerm(html, "class"))).toBe("const value = 1;");
		const hit = highlightSearchTerm(highlightLine("class Repo {}", "typescript"), "class");
		expect(visible(hit)).toBe("class Repo {}");
		expect(hit).toContain("<mark");
	});
});
