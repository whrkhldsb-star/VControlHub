import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/lib/theme/provider";
import type { PublicBoardResponse, PublicNode } from "@/lib/public-status/types";
import { PublicBoardClient } from "../public-board-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/status", useSearchParams: () => null }));

const now = "2026-10-13T12:00:00.000Z";

function node(id: string, name: string, overrides: Partial<PublicNode> = {}): PublicNode {
	return {
		id,
		name,
		group: "Asia",
		region: "Tokyo",
		countryCode: "JP",
		tags: ["prod"],
		note: null,
		status: "online",
		offlineReason: null,
		metricsStale: false,
		metricsAt: "2026-10-13T11:59:30.000Z",
		checkedAt: "2026-10-13T11:59:30.000Z",
		heartbeatAt: null,
		reportIntervalSeconds: 300,
		metrics: {
			cpu: { usage: 23.5, cores: 4 },
			memory: { usage: 61, usedBytes: 2 * 1024 ** 3, totalBytes: 4 * 1024 ** 3, swapUsage: null },
			disk: { usage: 47, usedBytes: 20 * 1024 ** 3, totalBytes: 40 * 1024 ** 3 },
			network: { rxBytesPerSecond: 1_572_864, txBytesPerSecond: 524_288, rateWindowSeconds: 300 },
		},
		system: null,
		billing: null,
		...overrides,
	};
}

function board(nodes: PublicNode[], overrides: Partial<PublicBoardResponse> = {}): PublicBoardResponse {
	return {
		site: { title: "Example Status", description: "Our nodes", announcement: "Maintenance on Saturday", defaultView: "cards", refreshSeconds: 15, accent: "default", metrics: ["cpu", "memory", "disk", "network"], showPlatformStatus: true },
		platform: { overall: "healthy" },
		summary: {
			total: nodes.length, online: nodes.filter((n) => n.status === "online").length, offline: nodes.filter((n) => n.status === "offline").length,
			stale: 0, unknown: 0, maintenance: 0, groups: [{ name: "Asia", total: nodes.length, online: nodes.length }], regions: [{ name: "Tokyo", total: nodes.length, online: nodes.length }], countries: [{ name: "JP", total: nodes.length, online: nodes.length }],
			rxBytesPerSecond: 1_572_864, txBytesPerSecond: 524_288, rateNodes: 1, periodRxBytes: null, periodTxBytes: null, lastSampleAt: "2026-10-13T11:59:30.000Z", truncated: false,
		},
		query: { q: "", group: "", status: "all", sort: "default", dir: "asc", page: 1, pageSize: 24 },
		filteredTotal: nodes.length,
		totalPages: 1,
		nodes,
		generatedAt: now,
		...overrides,
	};
}

function renderBoard(initial: PublicBoardResponse, props: { preview?: boolean; signedIn?: boolean } = {}) {
	return render(
		<ThemeProvider initialTheme="dark">
			<I18nProvider initialLocale="en">
				<PublicBoardClient initial={initial} preview={props.preview ?? false} signedIn={props.signedIn ?? false} />
			</I18nProvider>
		</ThemeProvider>,
	);
}

describe("PublicBoardClient", () => {
	const fetchMock = vi.fn();
	beforeEach(() => {
		window.localStorage.clear();
		window.history.replaceState(null, "", "/status");
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders site text, summary and cards with IEC units and no hidden categories", () => {
		renderBoard(board([node("aaaaaaaaaaaa", "Tokyo 1")]));
		expect(screen.getByRole("heading", { level: 1, name: "Example Status" })).toBeInTheDocument();
		expect(screen.getByText("Maintenance on Saturday")).toBeInTheDocument();
		expect(screen.getByText(/Platform status: operational/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Tokyo 1" })).toHaveAttribute("href", "/status/nodes/aaaaaaaaaaaa");
		expect(screen.getAllByText(/1\.50 MiB\/s/).length).toBeGreaterThan(0);
		// Traffic/latency/uptime were not published: no labels for them on the card.
		expect(screen.queryByText("TCP latency")).toBeNull();
		expect(screen.queryByText("Traffic this month")).toBeNull();
		expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2F");
		// Sorting options only include published metrics.
		const sort = screen.getByLabelText("Sort") as HTMLSelectElement;
		expect([...sort.options].map((o) => o.value)).toEqual(["default", "name", "cpu", "memory", "disk", "network", "status"]);
	});

	it("never shows zeros for a node without samples", () => {
		renderBoard(board([node("bbbbbbbbbbbb", "Fresh", { status: "unknown", metricsAt: null, checkedAt: null, metrics: {} })]));
		expect(screen.getAllByText("Not sampled yet").length).toBeGreaterThan(0);
		expect(screen.queryByText("0%")).toBeNull();
	});

	it("switches to the table view and remembers it locally", async () => {
		const user = userEvent.setup();
		renderBoard(board([node("aaaaaaaaaaaa", "Tokyo 1")]));
		await user.click(screen.getByRole("button", { name: "Table" }));
		expect(screen.getByRole("table", { name: "Public nodes" })).toBeInTheDocument();
		expect(window.localStorage.getItem("vch.publicStatus.view")).toBe("table");
	});

	it("searches through the URL and the public API only", async () => {
		const user = userEvent.setup();
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...board([node("aaaaaaaaaaaa", "Tokyo 1")]), filteredTotal: 0, nodes: [] }), { status: 200 }));
		renderBoard(board([node("aaaaaaaaaaaa", "Tokyo 1")]));
		await user.type(screen.getByRole("searchbox", { name: "Search" }), "osaka");
		await waitFor(() => expect(window.location.search).toContain("q=osaka"));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const url = String(fetchMock.mock.calls.at(-1)?.[0]);
		expect(url).toMatch(/^\/api\/status\/board\?/);
		expect(url).toContain("q=osaka");
		await waitFor(() => expect(screen.getByText("No node matches these filters.")).toBeInTheDocument());
		await user.click(screen.getByRole("button", { name: "Clear filters" }));
		await waitFor(() => expect(window.location.search).not.toContain("q="));
	});

	it("shows an empty board message and an admin hint in preview", () => {
		const { unmount } = renderBoard(board([]));
		expect(screen.getByText("No public nodes yet")).toBeInTheDocument();
		unmount();
		renderBoard(board([]), { preview: true, signedIn: true });
		expect(screen.getByRole("note")).toHaveTextContent(/Guest preview/);
		expect(screen.getByText(/Status Board Settings/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
	});

	it("keeps the last data and offers a retry when an update fails", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
			renderBoard(board([node("aaaaaaaaaaaa", "Tokyo 1")]));
			await act(async () => {
				vi.advanceTimersByTime(15_000);
			});
			await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Update failed/));
			expect(screen.getByRole("link", { name: "Tokyo 1" })).toBeInTheDocument();
			expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	});

	it("says so when the board was closed while viewing", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
			renderBoard(board([node("aaaaaaaaaaaa", "Tokyo 1")]));
			await act(async () => {
				vi.advanceTimersByTime(15_000);
			});
			await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no longer public/));
		} finally {
			vi.useRealTimers();
		}
	});
});
