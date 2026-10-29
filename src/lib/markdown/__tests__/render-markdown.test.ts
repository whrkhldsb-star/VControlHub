import { describe, expect, it } from "vitest";

import { MAX_RENDERED_MARKDOWN_CHARS, markdownExcerpt, markdownToPlainText, renderMarkdown } from "../render-markdown";

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

describe("renderMarkdown with a lone table-like row", () => {
	it("renders it as text instead of looping on it", () => {
		// No separator row follows, so it is no table; the paragraph rule
		// skipped it too, and the loop never moved past it.
		expect(renderMarkdown("| ordinary note |")).toBe("<p>| ordinary note |</p>");
		expect(renderMarkdown("Intro\n| a | b |\nmore")).toContain("| a | b |");
		expect(renderMarkdown("| h |\n| --- |\n| v |")).toContain("<table");
	}, 2_000);
});

describe("inline code", () => {
	it("keeps stars and link syntax inside backticks as written", () => {
		// Emphasis and links ran over the code too: `**keep**` came out bold,
		// `2 * 3 * 4` lost its stars, a literal link became a link.
		const html = renderMarkdown("Use `**keep**`, `2 * 3 * 4` and `[manual](https://example.test/help)` here, then **bold**.");
		expect(html).toContain("<code>**keep**</code>");
		expect(html).toContain("<code>2 * 3 * 4</code>");
		expect(html).toContain("<code>[manual](https://example.test/help)</code>");
		expect(html).not.toContain("<a ");
		expect(html).toContain("<strong>bold</strong>");
	});
});

describe("renderMarkdown keeps prose and inline code as written", () => {
	it("does not delete words that end in an assignment", () => {
		// A filter removed every "on…=" token before escaping: the preview of a
		// README showed "Set `max_c in postgresql.conf".
		const html = renderMarkdown("Set `max_connections=200` in postgresql.conf; notification_level=high, monitoring=on");
		expect(html).toContain("<code>max_connections=200</code>");
		expect(html).toContain("notification_level=high, monitoring=on");
	});

	it("keeps data: and javascript: when they are text, but never as a link", () => {
		const html = renderMarkdown("Inline images use data:image/png URLs; see [x](javascript:alert(1)) and `button.onclick = run`");
		expect(html).toContain("data:image/png URLs");
		expect(html).toContain("<code>button.onclick = run</code>");
		expect(html).not.toContain('href="javascript');
	});

	it("still renders markup in the text inert", () => {
		const html = renderMarkdown('<img src=x onerror="alert(1)"> and <script>alert(1)</script>');
		expect(html).not.toMatch(/<img|<script/i);
		expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
	});
});

describe("renderMarkdown hardening", () => {
	it("lets a fence name a language, not inject class names", () => {
		expect(renderMarkdown("```js\nlet a = 1;\n```")).toBe('<pre><code class="language-js">let a = 1;</code></pre>');
		expect(renderMarkdown("```c++\nint a;\n```")).toContain('class="language-c++"');
		expect(renderMarkdown('```js foo bar\nx\n```')).toBe("<pre><code>x</code></pre>");
		expect(renderMarkdown('```" onmouseover="x\nx\n```')).toBe("<pre><code>x</code></pre>");
	});

	it("shows an oversized document as plain text instead of running it through the inline regexes", () => {
		const huge = "*".repeat(MAX_RENDERED_MARKDOWN_CHARS + 1);
		const started = Date.now();
		expect(renderMarkdown(huge)).toBe(`<pre>${huge}</pre>`);
		expect(Date.now() - started).toBeLessThan(2_000);
	});
});
