import { describe, expect, it } from "vitest";

import { markdownExcerpt, markdownToPlainText, renderMarkdown } from "../render-markdown";

describe("markdownToPlainText", () => {
	it("drops markup for one-line excerpts", () => {
		expect(markdownToPlainText("Announcement body with **markdown** and a [link](https://example.com).\n\n- bullet one\n- bullet two")).toBe(
			"Announcement body with markdown and a link.\n\nbullet one\nbullet two",
		);
		expect(markdownToPlainText("# 维护窗口\n> 周六 `02:00` 起\n1. 备份\n2. 升级")).toBe("维护窗口\n周六 02:00 起\n备份\n升级");
	});

	it("keeps words with underscores and plain asterisks", () => {
		expect(markdownToPlainText("set max_connections to 5 * 2")).toBe("set max_connections to 5 * 2");
	});
});

describe("markdownExcerpt", () => {
	it("joins the text into one paragraph so a line clamp never cuts at a blank line", () => {
		expect(markdownExcerpt("Body with **markdown**.\n\n- one\n- two")).toBe("Body with markdown. one two");
	});
});

describe("renderMarkdown for announcements", () => {
	it("renders emphasis, links and lists instead of showing the syntax", () => {
		const html = renderMarkdown("Body with **markdown** and a [link](https://example.com).\n\n- one\n- two");
		expect(html).toContain("<strong>markdown</strong>");
		expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
		expect(html).toContain("<li>one</li>");
		expect(html).not.toContain("**");
	});
});

describe("markdownToPlainText keeps code as written", () => {
	it("leaves fenced blocks and inline code alone", () => {
		const source = "Run **this**:\n\n```python\nclass A:\n    def __init__(self):\n        pass\n---\n```\n\nThen call `__init__` and `a_b_c`.";
		const text = markdownToPlainText(source);
		expect(text).toContain("def __init__(self):");
		expect(text).toContain("\n---");
		expect(text).toContain("Run this:");
		expect(text).toContain("Then call __init__ and a_b_c.");
	});
});
