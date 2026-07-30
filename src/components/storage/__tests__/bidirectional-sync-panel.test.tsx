import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { BidirectionalSyncPanel } from "../bidirectional-sync-panel";

const servers = [
	{ id: "server-a", name: "Source", host: "10.0.0.1" },
	{ id: "server-b", name: "Target", host: "10.0.0.2" },
];

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("BidirectionalSyncPanel", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
		document.cookie = "csrf_token=test-token";
	});

	it("loads the job list once on mount", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ jobs: [] }));
		renderWithI18n(<BidirectionalSyncPanel servers={servers} />);

		expect(await screen.findByText("暂无同步任务")).toBeVisible();
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"/api/sync-jobs",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("creates through the unified API client and refreshes the list", async () => {
		vi.mocked(globalThis.fetch)
			.mockResolvedValueOnce(jsonResponse({ jobs: [] }))
			.mockResolvedValueOnce(jsonResponse({ job: { id: "job-1" } }, 201))
			.mockResolvedValueOnce(jsonResponse({ jobs: [] }));
		renderWithI18n(<BidirectionalSyncPanel servers={servers} />);
		await screen.findByText("暂无同步任务");

		fireEvent.click(screen.getByRole("button", { name: "创建同步任务" }));
		await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));

		const [, createInit] = vi.mocked(globalThis.fetch).mock.calls[1] ?? [];
		expect(createInit).toEqual(expect.objectContaining({ method: "POST" }));
		const headers = createInit?.headers as Headers;
		expect(headers.get("x-csrf-token")).toBe("test-token");
		expect(JSON.parse(String(createInit?.body))).toMatchObject({
			sourceServerId: "server-a",
			targetServerId: "server-b",
			syncType: "BIDIRECTIONAL",
		});
	});

	it("uses the shared notice for API errors", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ error: "同步服务不可用" }, 503));
		renderWithI18n(<BidirectionalSyncPanel servers={servers} />);

		expect(await screen.findByRole("alert")).toHaveTextContent("同步服务不可用");
	});
});
