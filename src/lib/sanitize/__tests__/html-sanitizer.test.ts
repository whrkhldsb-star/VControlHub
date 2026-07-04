import { describe, expect, it } from "vitest";
import { sanitizeHtml, sanitizeHighlightHtml } from "../html-sanitizer";

describe("sanitizeHtml (markdown config)", () => {
	describe("XSS prevention", () => {
		it("strips <script> tags and their content", () => {
			const result = sanitizeHtml("<p>safe</p><script>alert(1)</script>");
			expect(result).not.toContain("<script");
			expect(result).not.toContain("alert");
			expect(result).toContain("safe");
		});

		it("strips inline event handlers (onclick, onerror, onload)", () => {
			const result = sanitizeHtml('<p onclick="alert(1)">text</p>');
			expect(result).not.toContain("onclick");
			expect(result).toContain("text");
		});

		it("blocks javascript: URLs in href attributes", () => {
			const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
			expect(result).not.toContain("javascript:");
			expect(result).toContain("click");
		});

		it("blocks javascript: URLs regardless of casing or whitespace", () => {
			const result = sanitizeHtml('<a href="  JaVaScRiPt:alert(1)">x</a>');
			expect(result.toLowerCase()).not.toContain("javascript:");
		});

		it("blocks data: URLs in href that could execute script", () => {
			const result = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
			expect(result).not.toContain("<script");
		});

		it("strips <iframe> tags", () => {
			const result = sanitizeHtml('<iframe src="https://evil.com"></iframe><p>ok</p>');
			expect(result).not.toContain("<iframe");
			expect(result).not.toContain("evil.com");
			expect(result).toContain("ok");
		});

		it("strips <object> and <embed> tags", () => {
			const result = sanitizeHtml('<object data="evil.swf"></object><embed src="evil.swf">');
			expect(result).not.toContain("<object");
			expect(result).not.toContain("<embed");
		});

		it("strips <style> tags and their content", () => {
			const result = sanitizeHtml("<style>body{background:url(javascript:alert(1))}</style><p>ok</p>");
			expect(result).not.toContain("<style");
			expect(result).not.toContain("javascript:");
			expect(result).toContain("ok");
		});
	});

	describe("allowlist enforcement", () => {
		it("allows markdown formatting tags (strong, em, code, pre)", () => {
			const result = sanitizeHtml("<strong>bold</strong><em>italic</em><code>x</code><pre>block</pre>");
			expect(result).toContain("<strong>bold</strong>");
			expect(result).toContain("<em>italic</em>");
			expect(result).toContain("<code>x</code>");
			expect(result).toContain("<pre>block</pre>");
		});

		it("allows heading tags", () => {
			const result = sanitizeHtml("<h1>Title</h1><h2>Sub</h2><h3>Sub3</h3>");
			expect(result).toContain("<h1>Title</h1>");
			expect(result).toContain("<h2>Sub</h2>");
			expect(result).toContain("<h3>Sub3</h3>");
		});

		it("allows list tags (ul, ol, li)", () => {
			const result = sanitizeHtml("<ul><li>item1</li><li>item2</li></ul>");
			expect(result).toContain("<ul>");
			expect(result).toContain("<li>item1</li>");
		});

		it("allows table tags", () => {
			const result = sanitizeHtml("<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>");
			expect(result).toContain("<table>");
			expect(result).toContain("<th>H</th>");
			expect(result).toContain("<td>D</td>");
		});

		it("allows blockquote", () => {
			const result = sanitizeHtml("<blockquote>quoted text</blockquote>");
			expect(result).toContain("<blockquote>quoted text</blockquote>");
		});

		it("strips disallowed tags but keeps text content", () => {
			const result = sanitizeHtml("<div>text</div>");
			expect(result).not.toContain("<div");
			expect(result).toContain("text");
		});

		it("allows href, target, rel, class attributes on <a>", () => {
			const result = sanitizeHtml('<a href="https://example.com" target="_blank" rel="noopener" class="link">link</a>');
			expect(result).toContain('href="https://example.com"');
			expect(result).toContain('target="_blank"');
			expect(result).toContain('rel="noopener"');
			expect(result).toContain('class="link"');
		});

		it("strips data-* attributes", () => {
			const result = sanitizeHtml('<p data-foo="bar">text</p>');
			expect(result).not.toContain("data-foo");
		});

		it("strips style attributes", () => {
			const result = sanitizeHtml('<p style="color:red">text</p>');
			expect(result).not.toContain("style");
			expect(result).toContain("text");
		});
	});

	describe("edge cases", () => {
		it("handles empty string", () => {
			expect(sanitizeHtml("")).toBe("");
		});

		it("passes through plain text", () => {
			expect(sanitizeHtml("just plain text")).toBe("just plain text");
		});

		it("preserves nested allowed tags", () => {
			const result = sanitizeHtml("<ul><li><strong>bold item</strong></li></ul>");
			expect(result).toContain("<strong>bold item</strong>");
			expect(result).toContain("<li>");
		});

		it("removes disallowed parent but keeps allowed children", () => {
			const result = sanitizeHtml("<div><p>kept</p></div>");
			expect(result).not.toContain("<div");
			expect(result).toContain("<p>kept</p>");
		});

		it("handles malformed HTML gracefully", () => {
			const result = sanitizeHtml("<p>unclosed");
			expect(result).toContain("unclosed");
		});

		it("allows horizontal rule and line break", () => {
			const result = sanitizeHtml("<p>line1<br>line2</p><hr>");
			expect(result).toContain("<br>");
			expect(result).toContain("<hr>");
		});
	});
});

describe("sanitizeHighlightHtml (highlight config)", () => {
	it("allows <span> tags with class attribute", () => {
		const result = sanitizeHighlightHtml('<span class="token keyword">function</span>');
		expect(result).toContain("<span");
		expect(result).toContain('class="token keyword"');
		expect(result).toContain("function");
	});

	it("allows <br> tags", () => {
		const result = sanitizeHighlightHtml("line1<br>line2");
		expect(result).toContain("<br>");
	});

	it("strips <script> tags", () => {
		const result = sanitizeHighlightHtml("<script>alert(1)</script><span>ok</span>");
		expect(result).not.toContain("<script");
		expect(result).toContain("ok");
	});

	it("strips event handlers from allowed span tags", () => {
		const result = sanitizeHighlightHtml('<span class="x" onclick="alert(1)">text</span>');
		expect(result).not.toContain("onclick");
		expect(result).toContain("text");
	});

	it("strips disallowed tags (p, div, a) but keeps text", () => {
		const result = sanitizeHighlightHtml("<p>paragraph</p><div>div</div><a>link</a>");
		expect(result).not.toContain("<p");
		expect(result).not.toContain("<div");
		expect(result).not.toContain("<a");
		expect(result).toContain("paragraph");
		expect(result).toContain("div");
		expect(result).toContain("link");
	});

	it("strips href and target attributes (not in highlight allowlist)", () => {
		const result = sanitizeHighlightHtml('<span href="x" target="_blank">text</span>');
		expect(result).not.toContain("href");
		expect(result).not.toContain("target");
	});

	it("strips data-* attributes", () => {
		const result = sanitizeHighlightHtml('<span data-id="1">text</span>');
		expect(result).not.toContain("data-id");
	});

	it("handles empty string", () => {
		expect(sanitizeHighlightHtml("")).toBe("");
	});
});
