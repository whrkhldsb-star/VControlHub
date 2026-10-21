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
