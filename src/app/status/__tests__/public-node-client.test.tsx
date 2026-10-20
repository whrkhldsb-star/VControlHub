import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/lib/theme/provider";
import type { PublicHistoryResponse, PublicNodeDetailResponse } from "@/lib/public-status/types";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/http/api-client", async (original) => ({
	...await original<typeof import("@/lib/http/api-client")>(),
	api,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/status/nodes/abcdefghijkl", useSearchParams: () => null }));

const { ApiError } = await import("@/lib/http/api-client");
const { PublicNodeClient } = await import("../nodes/[publicId]/public-node-client");

const now = "2026-10-13T12:00:00.000Z";
const detail = {
	site: { title: "Example Status", description: null, announcement: null, defaultView: "cards", refreshSeconds: 15, accent: "default", metrics: ["cpu", "memory"], showPlatformStatus: false },
	node: {
		id: "abcdefghijkl", name: "Tokyo 1", group: null, region: null, countryCode: null, tags: [], note: null,
		status: "online", offlineReason: null, metricsStale: false, metricsAt: now, checkedAt: now, heartbeatAt: null, reportIntervalSeconds: 300,
		metrics: { cpu: { usage: 20, cores: 2 }, memory: { usage: 40, usedBytes: 1, totalBytes: 2, swapUsage: null } },
		system: null, billing: null,
	},
	availability: null,
	uptimeDays: null,
	generatedAt: now,
} as unknown as PublicNodeDetailResponse;
const history: PublicHistoryResponse = {
	range: "24h", from: "2026-10-12T12:00:00.000Z", to: now, bucketSeconds: 300, sampleIntervalSeconds: 300, coveragePercent: 100, samples: 288,
	resources: [{ t: "2026-10-13T11:55:00.000Z", cpu: 20, memory: 40 }], network: null, latency: null, generatedAt: now,
};

describe("PublicNodeClient history", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		api.get.mockReset();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("says so when a later history refresh fails, and offers a retry, while keeping the last chart", async () => {
		// The retained chart used to hide the failure: no warning, no retry.
		let historyCalls = 0;
		api.get.mockImplementation(async (url: string) => {
			if (!url.includes("/history")) return detail;
			historyCalls += 1;
			if (historyCalls === 1) return history;
			throw new ApiError(503, { message: "Service unavailable" });
		});
		render(
			<ThemeProvider initialTheme="dark">
				<I18nProvider initialLocale="en">
					<PublicNodeClient initial={detail} initialRange="24h" preview={false} signedIn={false} />
				</I18nProvider>
			</ThemeProvider>,
		);
		expect(await screen.findByText(/288 samples/)).toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();

		await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
		expect(historyCalls).toBeGreaterThanOrEqual(2);
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("Could not refresh the history");
		expect(screen.getByText(/288 samples/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
	});
});
