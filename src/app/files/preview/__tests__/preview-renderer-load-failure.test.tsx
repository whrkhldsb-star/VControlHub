import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The sanitizer is loaded as its own chunk. A page opened before a deploy asks
// for a chunk the new build no longer has, and the import rejects.
vi.mock("@/lib/sanitize/html-sanitizer", () => {
	throw new Error("Loading chunk 4821 failed");
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn(async () => ({ ok: true, text: async () => "alpha\nbeta\n" })) }));

import { MarkdownPreviewClient } from "../markdown-preview-client";
import { TextPreviewClient } from "../text-preview-client";

describe("file previews whose renderer chunk fails to load", () => {
	afterEach(() => { vi.unstubAllGlobals(); });

	it.each([
		["Markdown", () => <MarkdownPreviewClient href="/download/readme.md" />],
		["text", () => <TextPreviewClient href="/download/notes.txt" name="notes.txt" />],
	])("says so in the %s preview instead of loading for ever", async (_kind, preview) => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("# hello\n", { status: 200 })));
		render(preview());
		expect(await screen.findByText("预览组件加载失败，页面可能已更新，请刷新后重试")).toBeInTheDocument();
	});
});
