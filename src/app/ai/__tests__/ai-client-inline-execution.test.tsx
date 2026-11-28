import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { AiClient } from "../ai-client";
import { type AiCapabilities, DEFAULT_AI_CAPABILITIES } from "../ai-automation-mode";
import type { ConvItem, HostedAction, Message, Provider } from "../ai-types";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: routerPush }),
	useSearchParams: () => new URLSearchParams(window.location.search),
}));
const addToastMock = vi.fn();
vi.mock("@/components/toast-provider", () => ({
	useToast: () => ({ addToast: addToastMock }),
	ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const provider: Provider = {
	id: "provider-1", name: "OpenAI", type: "OPENAI_COMPATIBLE", apiKey: "", baseUrl: "https://api.openai.com/v1",
	defaultModel: "gpt-4o-mini", availableModels: "gpt-4o-mini", isDefault: true, enabled: true, settings: "{}",
};

const conversation: ConvItem = {
	id: "conv-1", title: "磁盘排查", providerId: "provider-1", model: "gpt-4o-mini", systemPrompt: null, temperature: 0.7,
	maxTokens: 4096, topP: 1, frequencyPenalty: 0, presencePenalty: 0, enableVision: false, hostingEnabled: true,
	automationMode: "ASSISTED", automationModeExpiresAt: null, pinnedServerIds: [], createdBy: "user-1",
	createdAt: "2026-11-28T00:00:00.000Z", updatedAt: "2026-11-28T00:00:00.000Z",
	provider: { id: "provider-1", name: "OpenAI", type: "OPENAI_COMPATIBLE" },
};

const capabilities: AiCapabilities = {
	...DEFAULT_AI_CAPABILITIES,
	canExecute: true,
	canAuto: true,
	aiMaxAutomationMode: "auto",
	aiCommandPolicy: "high_risk",
};

const action = (status: HostedAction["status"], result: string | null = null): HostedAction => ({
	id: "act-1", conversationId: "conv-1", messageId: "msg-1", toolCallId: "tc-1", serverId: "srv-1", actionType: "execute_command",
	actionName: "Execute command", params: JSON.stringify({ serverId: "srv-1", command: "df -h" }), status, riskLevel: "low",
	effectiveRisk: "low", riskReasons: ["low.readonly_inspect"], decisionSource: status === "PENDING_APPROVAL" ? null : "REQUESTER_CONFIRMED",
	commandRequestId: status === "PENDING_APPROVAL" ? null : "cmd-1", autoApproved: false, result, errorMessage: null,
	createdAt: "2026-11-28T00:01:00.000Z", approvedAt: null, executedAt: null, completedAt: null,
	server: { id: "srv-1", name: "web-1", host: "10.0.0.1" },
});

const proposal = (status: HostedAction["status"], result: string | null = null): Message => ({
	id: "msg-1", conversationId: "conv-1", role: "assistant", content: "我先看一下磁盘占用。", reasoningContent: null, imageUrls: "[]",
	model: "gpt-4o-mini", inputTokens: null, outputTokens: null, latencyMs: null, createdAt: "2026-11-28T00:01:00.000Z",
	hostedActions: [action(status, result)],
});

const answer: Message = {
	id: "msg-2", conversationId: "conv-1", role: "assistant", content: "根分区只用了 12%，磁盘没有问题。", reasoningContent: null,
	imageUrls: "[]", model: "gpt-4o-mini", inputTokens: 5, outputTokens: 9, latencyMs: 800, createdAt: "2026-11-28T00:03:00.000Z",
};

function sse(frames: unknown[]) {
	const encoder = new TextEncoder();
	return new Response(new ReadableStream({
		start(controller) {
			for (const value of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
			controller.close();
		},
	}), { status: 200 });
}

describe("AiClient inline execution", () => {
	beforeEach(() => {
		window.history.replaceState({}, "", "/ai");
		vi.clearAllMocks();
		Element.prototype.scrollIntoView = vi.fn();
		Object.defineProperty(window, "matchMedia", {
			writable: true,
			value: vi.fn().mockImplementation((query: string) => ({
				matches: query.includes("min-width"), media: query, onchange: null,
				addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
			})),
		});
	});

	it("runs a confirmed command here, shows its live output, then continues the answer with the real result", async () => {
		const user = userEvent.setup();
		let stage: "proposed" | "running" | "done" | "answered" = "proposed";
		let polls = 0;
		const result = JSON.stringify({ commandRequestId: "cmd-1", exitCode: 0, stdout: "/dev/sda1 40G 12%" });
		vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
			const url = String(input);
			if (url === "/api/ai/conversations/conv-1" && !init) {
				const messages = stage === "proposed" ? [proposal("PENDING_APPROVAL")]
					: stage === "running" ? [proposal("EXECUTING")]
						: stage === "done" ? [proposal("COMPLETED", result)]
							: [proposal("COMPLETED", result), answer];
				return { conversation: { ...conversation, messages } };
			}
			if (url === "/api/ai/hosted-actions/act-1" && init?.method === "PATCH") {
				stage = "running";
				return { accepted: true, completed: false, executedInline: true, requiresApproval: false, commandRequestId: "cmd-1", success: true, action: { id: "act-1", status: "EXECUTING" } };
			}
			if (url === "/api/ai/hosted-actions/act-1" && !init?.method) {
				polls += 1;
				if (polls >= 2) stage = "done";
				const status = polls >= 2 ? "COMPLETED" : "EXECUTING";
				return {
					action: { id: "act-1", status, commandRequestId: "cmd-1" },
					command: {
						id: "cmd-1", status: polls >= 2 ? "COMPLETED" : "RUNNING", command: "df -h", origin: "AI_CHAT", riskLevel: "low",
						decisionSource: "REQUESTER_CONFIRMED",
						targets: [{ id: "t-1", serverId: "srv-1", serverName: "web-1", status: polls >= 2 ? "COMPLETED" : "RUNNING", exitCode: polls >= 2 ? 0 : null, outcomeUnknown: false, stdout: "/dev/sda1 40G 12%", stderr: null, finishedAt: null }],
					},
				};
			}
			if (url === "/api/ai/conversations/conv-1/continue") {
				stage = "answered";
				return sse([{ type: "content", content: "根分区只用了 12%，" }, { type: "content", content: "磁盘没有问题。" }, { type: "done" }]);
			}
			if (url === "/api/ai/models?providerId=provider-1") return { models: [{ id: "gpt-4o-mini", name: "gpt-4o-mini" }] };
			if (url === "/api/ai/conversations") return { conversations: [conversation] };
			return {};
		});

		render(<AiClient userId="user-1" initialProviders={[provider]} initialConversations={[conversation]} capabilities={capabilities} />);
		await user.click(screen.getByText("磁盘排查"));
		const card = await screen.findByText("确认后立即在服务器上执行，并在这里显示实时输出。");
		await user.click(within(card.closest("[data-approval-card]") as HTMLElement).getByRole("button", { name: "确认并执行" }));

		expect(JSON.parse(vi.mocked(csrfFetch).mock.calls.find(([url, init]) => url === "/api/ai/hosted-actions/act-1" && init?.method === "PATCH")![1]!.body as string)).toEqual({ action: "confirm" });
		// Live output of the running command, in the conversation.
		const panel = await screen.findByRole("region", { name: "执行进度" });
		await waitFor(() => expect(panel).toHaveTextContent("/dev/sda1 40G 12%"));
		expect(within(panel).getByRole("link", { name: "查看命令申请" })).toHaveAttribute("href", "/requests?requestId=cmd-1");

		// Settled: the page continues the answer by itself, once.
		await waitFor(() => expect(screen.getByText("根分区只用了 12%，磁盘没有问题。")).toBeInTheDocument(), { timeout: 10_000 });
		const continues = vi.mocked(csrfFetch).mock.calls.filter(([url]) => url === "/api/ai/conversations/conv-1/continue");
		expect(continues).toHaveLength(1);
		// Never bounced to the approvals page.
		expect(routerPush).not.toHaveBeenCalled();
		expect(window.location.pathname).toBe("/ai");
	}, 20_000);

	it("files a review receipt instead of claiming the command ran", async () => {
		const user = userEvent.setup();
		let stage: "proposed" | "review" = "proposed";
		vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
			const url = String(input);
			if (url === "/api/ai/conversations/conv-1" && !init) {
				return { conversation: { ...conversation, messages: [proposal(stage === "proposed" ? "PENDING_APPROVAL" : "APPROVED", stage === "review" ? JSON.stringify({ commandRequestId: "cmd-7" }) : null)] } };
			}
			if (url === "/api/ai/hosted-actions/act-1" && init?.method === "PATCH") {
				stage = "review";
				return { accepted: true, completed: false, executedInline: false, requiresApproval: true, commandRequestId: "cmd-7", success: true, action: { id: "act-1", status: "APPROVED" } };
			}
			if (url === "/api/ai/hosted-actions/act-1") {
				return { action: { id: "act-1", status: "APPROVED", commandRequestId: "cmd-7" }, command: { id: "cmd-7", status: "PENDING_APPROVAL", command: "df -h", origin: "AI_CHAT", riskLevel: "low", decisionSource: null, targets: [] } };
			}
			if (url === "/api/ai/models?providerId=provider-1") return { models: [] };
			if (url === "/api/ai/conversations") return { conversations: [conversation] };
			return {};
		});

		render(<AiClient userId="user-1" initialProviders={[provider]} initialConversations={[conversation]} capabilities={{ ...capabilities, aiCommandPolicy: "always" }} />);
		await user.click(screen.getByText("磁盘排查"));
		await user.click(await screen.findByRole("button", { name: "确认创建请求" }));

		expect(await screen.findByText("已提交同行审批")).toBeInTheDocument();
		expect(screen.getByText("这条命令还没有执行：需要另一位审批人批准后才会运行。")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "查看命令申请" })).toHaveAttribute("href", "/requests?requestId=cmd-7");
		expect(addToastMock).toHaveBeenCalledWith("success", "已提交给其他审批人，批准后才会执行");
		expect(vi.mocked(csrfFetch).mock.calls.some(([url]) => String(url).endsWith("/continue"))).toBe(false);
	});
});
