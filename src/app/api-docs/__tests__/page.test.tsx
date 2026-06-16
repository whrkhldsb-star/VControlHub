import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ApiDocsPageClient from "../api-docs-page-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

const spec = {
	info: { description: "本地 API 说明" },
	tags: [{ name: "系统", description: "系统接口" }],
	paths: {
		"/health": {
			get: { tags: ["系统"], summary: "健康检查", responses: { "200": { description: "OK" } } },
		},
		"/test": {
			get: {
				tags: ["系统"],
				summary: "测试参数",
				parameters: [
					{ name: "id", in: "query", description: "标识" },
				],
				responses: { "200": { description: "OK" } },
			},
		},
	},
};

describe("ApiDocsPage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("renders OpenAPI routes locally without injecting external Scalar assets", async () => {
		const appendSpy = vi.spyOn(document.head, "appendChild");
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: true,
			json: async () => spec,
		} as Response);

		render(<ApiDocsPageClient />);

		expect(await screen.findByRole("heading", { name: "API 文档" })).toBeInTheDocument();
		expect(await screen.findByText("健康检查")).toBeInTheDocument();
		expect(screen.getByText("/api/health")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "OpenAPI JSON" })).toHaveAttribute("href", "/api/docs/openapi.json");
		await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/docs/openapi.json", { credentials: "same-origin" }));
		// Count templates are now i18n-aware and produce "{count}/{total} 个接口" / "{count} 个接口" / "参数 {count}".
		expect(await screen.findByText("2/2 个接口")).toBeInTheDocument();
		expect(screen.getByText("2 个接口")).toBeInTheDocument();
		expect(screen.getByText("参数 1")).toBeInTheDocument();
		expect(appendSpy).not.toHaveBeenCalledWith(expect.objectContaining({ src: expect.stringContaining("scalar") }));
		expect(appendSpy).not.toHaveBeenCalledWith(expect.objectContaining({ href: expect.stringContaining("scalar") }));
	});
});
