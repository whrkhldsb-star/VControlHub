import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ItsmPageClient } from "../itsm-page-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { I18nProvider } from "@/lib/i18n/provider";
import type { ItsmConnectionRecord, ItsmEventRecord } from "@/lib/itsm/types";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

const toastSpy = vi.fn();
vi.mock("@/components/toast-provider", () => ({
	useToast: () => ({ addToast: toastSpy }),
}));

function wrap(ui: React.ReactElement) {
	return <I18nProvider initialLocale="zh">{ui}</I18nProvider>;
}

const connection: ItsmConnectionRecord = {
	id: "conn-1",
	name: "值班 Slack",
	provider: "slack",
	direction: "bidirectional",
	enabled: true,
	config: { webhookUrl: "https://hooks.example.com/x" },
	hasCredentials: true,
	teamId: "team-1",
	lastOutboundAt: null,
	lastInboundAt: null,
	lastError: null,
	createdById: "user-1",
	createdAt: "2026-07-01T00:00:00.000Z",
	updatedAt: "2026-07-01T00:00:00.000Z",
};

const emptyEvents: ItsmEventRecord[] = [];

describe("ItsmPageClient destructive UX", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		toastSpy.mockReset();
		vi.mocked(csrfFetch).mockReset();
	});

	it("surfaces reload failures via toast instead of silent catch", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValue(new Error("网络不可用"));

		render(
			wrap(
				<ItsmPageClient
					initialConnections={[connection]}
					initialEvents={emptyEvents}
					canManage
					publicBaseUrl="https://example.test"
				/>,
			),
		);

		await user.click(screen.getByRole("button", { name: "刷新" }));

		await waitFor(() => {
			expect(toastSpy).toHaveBeenCalledWith("error", "网络不可用");
		});
	});

	it("requires confirmation before deleting a connection", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
			const url = String(input);
			if (url.includes("/api/itsm/connections/conn-1") && init?.method === "DELETE") {
				return { ok: true };
			}
			if (url.includes("/api/itsm/connections") && !url.includes("events")) {
				return { connections: [] };
			}
			if (url.includes("/api/itsm/events")) {
				return { events: [] };
			}
			return {};
		});

		render(
			wrap(
				<ItsmPageClient
					initialConnections={[connection]}
					initialEvents={emptyEvents}
					canManage
					publicBaseUrl="https://example.test"
				/>,
			),
		);

		await user.click(screen.getByRole("button", { name: "删除" }));
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByText(/确认删除连接「值班 Slack」/)).toBeInTheDocument();
		expect(csrfFetch).not.toHaveBeenCalledWith(
			"/api/itsm/connections/conn-1",
			expect.objectContaining({ method: "DELETE" }),
		);

		const confirmButtons = screen.getAllByRole("button", { name: "删除" });
		// dialog confirm is the last "删除" after list row button remains mounted
		await user.click(confirmButtons[confirmButtons.length - 1]!);

		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith(
				"/api/itsm/connections/conn-1",
				expect.objectContaining({ method: "DELETE" }),
			);
		});
		await waitFor(() => {
			expect(toastSpy).toHaveBeenCalledWith("success", "连接已删除");
		});
	});
});
