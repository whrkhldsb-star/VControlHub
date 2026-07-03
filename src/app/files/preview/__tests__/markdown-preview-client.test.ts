import { describe, expect, it } from "vitest";

import { renderMarkdown } from "../markdown-preview-client";
import { sanitizeHtml } from "@/lib/sanitize/html-sanitizer";

describe("markdown preview sanitization", () => {
	it("escapes inline raw HTML before rendering markdown", () => {
		const html = sanitizeHtml(renderMarkdown("# Hello <img src=x onerror=alert(1)>\n\n**<script>alert(1)</script>**"));

		expect(html).toContain("&lt;img src=x )&gt;");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).not.toContain("<img");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onerror");
	});

	it("removes dangerous link URLs and inline styles while keeping safe formatting", () => {
		const html = sanitizeHtml(renderMarkdown("[bad](javascript:alert(1)) [ok](https://example.com)\n\n| A | B |\n| :-: | --: |\n| x | y |"));

		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("style=");
		expect(html).toContain("href=\"https://example.com\"");
		expect(html).toContain("class=\"align-center\"");
		expect(html).toContain("class=\"align-right\"");
	});
});
