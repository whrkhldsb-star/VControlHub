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

	it("keeps a next connection typed while the previous one was saving", async () => {
		const user = userEvent.setup();
		let finish: (value: unknown) => void = () => undefined;
		vi.mocked(csrfFetch).mockImplementation(((_url: string, init?: { method?: string }) =>
			init?.method === "POST" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ connections: [], events: [] })) as never);
		render(wrap(<ItsmPageClient initialConnections={[]} initialEvents={emptyEvents} canManage publicBaseUrl="https://example.test" />));

		const name = screen.getByPlaceholderText("例如：值班 Slack");
		await user.type(name, "A");
		await user.click(screen.getByRole("button", { name: "创建连接" }));
		await user.clear(name);
		await user.type(name, "B");
		finish({ id: "conn-a" });

		await waitFor(() => expect(toastSpy).toHaveBeenCalledWith("success", expect.any(String)));
		expect(name).toHaveValue("B");
	});

	it("sends only the fields of the chosen channel", async () => {
		// A field hidden by a change of channel kept what had been typed into it and was sent along: a Telegram
		// connection was saved (and listed) with the webhook address typed for Slack a moment earlier, and a Slack
		// connection stored a bot token it has no use for.
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValue({ connections: [], events: [] } as never);
		render(wrap(<ItsmPageClient initialConnections={[]} initialEvents={emptyEvents} canManage publicBaseUrl="https://example.test" />));

		await user.type(screen.getByPlaceholderText("例如：值班 Slack"), "值班群");
		await user.type(screen.getByLabelText("Webhook URL"), "https://hooks.slack.com/services/T/B/x");
		await user.selectOptions(screen.getByLabelText("提供商"), "telegram");
		await user.type(screen.getByLabelText("Bot Token"), "123:abc");
		await user.type(screen.getByLabelText("Chat ID"), "-100123");
		await user.click(screen.getByRole("button", { name: "创建连接" }));

		await waitFor(() => expect(vi.mocked(csrfFetch).mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toBe(true));
		const sent = () => {
			const posts = vi.mocked(csrfFetch).mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "POST");
			return JSON.parse(String((posts.at(-1)![1] as RequestInit).body)) as { provider: string; credentials: Record<string, string>; config: Record<string, unknown> };
		};
		expect(sent().provider).toBe("telegram");
		expect(sent().config).toEqual({ chatId: "-100123", createOnInbound: true });
		expect(sent().credentials).toEqual({ botToken: "123:abc" });

		// And the other way round.
		await user.type(screen.getByPlaceholderText("例如：值班 Slack"), "运维群");
		await user.type(screen.getByLabelText("Bot Token"), "456:def");
		await user.type(screen.getByLabelText("Chat ID"), "-100456");
		await user.selectOptions(screen.getByLabelText("提供商"), "slack");
		await user.type(screen.getByLabelText("Webhook URL"), "https://hooks.slack.com/services/T/B/y");
		await user.click(screen.getByRole("button", { name: "创建连接" }));
		await waitFor(() => expect(sent().provider).toBe("slack"));
		expect(sent().config).toEqual({ webhookUrl: "https://hooks.slack.com/services/T/B/y", createOnInbound: true });
		expect(sent().credentials).toEqual({});
	});

	it("takes the secrets in fields that hide them and that the browser does not remember", async () => {
		const user = userEvent.setup();
		render(wrap(<ItsmPageClient initialConnections={[]} initialEvents={emptyEvents} canManage publicBaseUrl="https://example.test" />));
		const secret = screen.getByLabelText("入站签名密钥");
		expect(secret).toHaveAttribute("type", "password");
		expect(secret).toHaveAttribute("autocomplete", "new-password");
		await user.selectOptions(screen.getByLabelText("提供商"), "telegram");
		const token = screen.getByLabelText("Bot Token");
		expect(token).toHaveAttribute("type", "password");
		expect(token).toHaveAttribute("autocomplete", "new-password");
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

	it("renders event direction, type, and status as user-facing labels", () => {
		const event: ItsmEventRecord = {
			id: "event-1",
			connectionId: connection.id,
			direction: "outbound",
			eventType: "ticket.created",
			ticketId: "ticket-1",
			status: "ok",
			externalId: null,
			payload: {},
			errorMessage: null,
			createdAt: "2026-07-01T00:00:00.000Z",
		};

		render(wrap(<ItsmPageClient initialConnections={[connection]} initialEvents={[event]} canManage publicBaseUrl="https://example.test" />));

		expect(screen.getByText("仅出站 · 工单已创建 · 成功")).toBeInTheDocument();
		expect(screen.getByText("关联工单：ticket-1")).toBeInTheDocument();
	});
});
