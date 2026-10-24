import { describe, expect, it } from "vitest";

import { renderMarkdown } from "@/lib/markdown/render-markdown";
import { sanitizeHtml } from "@/lib/sanitize/html-sanitizer";

function elementsOf(html: string): Element[] {
	const host = document.createElement("div");
	host.innerHTML = html;
	return [...host.querySelectorAll("*")];
}

describe("markdown preview sanitization", () => {
	it("escapes inline raw HTML before rendering markdown", () => {
		const html = sanitizeHtml(renderMarkdown("# Hello <img src=x onerror=alert(1)>\n\n**<script>alert(1)</script>**"));

		// Shown as the text it is, escaped: words were deleted from it before
		// ("max_connections=200" read "max_c"), which protected nothing.
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).not.toContain("<img");
		expect(html).not.toContain("<script");
		expect(elementsOf(html).some((element) => element.hasAttribute("onerror"))).toBe(false);
	});

	it("removes dangerous link URLs and inline styles while keeping safe formatting", () => {
		const html = sanitizeHtml(renderMarkdown("[bad](javascript:alert(1)) [ok](https://example.com)\n\n| A | B |\n| :-: | --: |\n| x | y |"));

		// Not a link: the text stays, inert.
		expect(html).not.toContain('href="javascript');
		expect(elementsOf(html).filter((element) => element.tagName === "A").map((a) => a.getAttribute("href"))).toEqual(["https://example.com"]);
		expect(html).not.toContain("style=");
		expect(html).toContain("href=\"https://example.com\"");
		expect(html).toContain("class=\"align-center\"");
		expect(html).toContain("class=\"align-right\"");
	});

	it("escapes markdown link text and attributes before sanitizer runs", () => {
		const html = renderMarkdown('[<img src=x onerror=alert(1)>](https://example.com/" onclick="alert(1)) [rel](/files/readme.md) [bad](ftp://example.com)');

		// The quotes stay encoded, so they cannot end the attribute: the
		// would-be onclick is part of the URL, not an attribute of its own.
		expect(html).toContain('href="https://example.com/&quot; onclick=&quot;alert(1"');
		expect(elementsOf(html).some((element) => element.hasAttribute("onclick"))).toBe(false);
		expect(html).toContain('href="/files/readme.md"');
		expect(html).not.toContain("<img");
		expect(html).not.toContain('onclick="alert');
		expect(html).not.toContain('href="ftp://example.com"');
	});

	it("escapes link URLs and text once, so query strings and ampersands survive", () => {
		const html = renderMarkdown("[Q&A](https://example.com/search?a=1&b=2)");
		expect(html).toContain('href="https://example.com/search?a=1&amp;b=2"');
		expect(html).toContain(">Q&amp;A</a>");
		expect(html).not.toContain("&amp;amp;");
	});
});
