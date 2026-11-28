import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requirePagePermission: vi.fn(),
	listProviders: vi.fn(),
	listChatProviders: vi.fn(),
	listConversations: vi.fn(),
	findServers: vi.fn(),
	findServer: vi.fn(),
	findConversation: vi.fn(),
	getApprovalPolicySettings: vi.fn(),
}));

vi.mock("@/lib/auth/page-guard", () => ({ requirePagePermission: mocks.requirePagePermission }));
vi.mock("@/lib/db", () => ({
	prisma: {
		server: { findMany: mocks.findServers, findFirst: mocks.findServer },
		aiConversation: { findFirst: mocks.findConversation },
	},
}));
vi.mock("@/lib/command/approval-policy-settings", () => ({ getApprovalPolicySettings: mocks.getApprovalPolicySettings }));
vi.mock("@/lib/ai/service", async () => {
	const serialize = await vi.importActual<typeof import("@/lib/ai/service-serialize")>("@/lib/ai/service-serialize");
	return {
		listProviders: mocks.listProviders,
		listChatProviders: mocks.listChatProviders,
		listConversations: mocks.listConversations,
		serializeProvider: serialize.serializeProvider,
		serializeConversationListItem: serialize.serializeConversationListItem,
	};
});
vi.mock("../ai-client", () => ({ AiClient: () => null }));

import AiPage from "../page";

const provider = {
	id: "p1", name: "OpenAI", type: "openai", apiKey: "v1:0123456789abcdef0123456789abcdef", baseUrl: "https://api.openai.com/v1",
	defaultModel: null, availableModels: "[]", isDefault: true, enabled: true, settings: { reasoningEffort: "high" },
	createdBy: "u1", createdAt: new Date("2026-11-01T00:00:00.000Z"), updatedAt: new Date("2026-11-02T00:00:00.000Z"),
};

const policies = {
	commandApprovalPolicy: "never",
	aiCommandApprovalPolicy: "inherit",
	deployApprovalPolicy: "always",
	commandSelfReview: "approvers",
	aiMaxAutomationMode: "auto",
	aiFullAutoAllowCritical: true,
};

describe("/ai page", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requirePagePermission.mockResolvedValue({ userId: "u1", roles: ["admin"] });
		mocks.listProviders.mockResolvedValue([provider]);
		mocks.listConversations.mockResolvedValue([]);
		mocks.findServers.mockResolvedValue([{ id: "srv-1", name: "web-1", host: "10.0.0.1" }]);
		mocks.findServer.mockResolvedValue(null);
		mocks.findConversation.mockResolvedValue(null);
		mocks.getApprovalPolicySettings.mockResolvedValue(policies);
	});

	it("asks for the chat permission and bounds the prefilled question", async () => {
		const element = await AiPage({ searchParams: Promise.resolve({ q: "x".repeat(5000) }) });
		expect(mocks.requirePagePermission).toHaveBeenCalledWith("ai:chat", { redirectTo: "/ai" });
		expect(element.props.initialDraft).toHaveLength(2000);
	});

	it("queries only selectable models when management has been revoked", async () => {
		mocks.requirePagePermission.mockResolvedValue({ userId: "u1", roles: [], permissions: ["ai:chat"] });
		mocks.listProviders.mockClear();
		mocks.listChatProviders.mockResolvedValue([{ id: "p1", name: "Model", enabled: true }]);
		const page = await AiPage({ searchParams: Promise.resolve({}) });
		expect(page.props.canManageProviders).toBe(false);
		expect(mocks.listProviders).not.toHaveBeenCalled();
		expect(page.props.initialProviders[0]).not.toHaveProperty("baseUrl");
	});

	it("hands the client each provider's settings as JSON text and never its stored key", async () => {
		const element = await AiPage({ searchParams: Promise.resolve({}) });
		const [sent] = element.props.initialProviders;
		// It was String(object): "[object Object]".
		expect(sent.settings).toBe('{"reasoningEffort":"high"}');
		expect(sent.defaultModel).toBe("");
		expect(sent.apiKey).toBe("••••••••");
		expect(JSON.stringify(element.props)).not.toContain(provider.apiKey);
	});

	it("passes the account's AI capabilities and the platform's mode ceiling to the client", async () => {
		const element = await AiPage({ searchParams: Promise.resolve({}) });
		expect(element.props.capabilities).toEqual({
			canAuto: true,
			canFullAuto: true,
			canExecute: true,
			canApprove: true,
			canReadServers: true,
			aiMaxAutomationMode: "auto",
			selfReviewPolicy: "approvers",
			isPlatformAdmin: true,
			// "inherit" is resolved: the AI chat policy follows the command policy.
			aiCommandPolicy: "never",
			fullAutoAllowCritical: true,
			maxFullAutoTtlMinutes: 60,
			defaultFullAutoTtlMinutes: 30,
		});
	});

	it("names only the modes an operator's permissions allow", async () => {
		mocks.requirePagePermission.mockResolvedValue({ userId: "u2", roles: [], permissions: ["ai:chat", "ai:action:auto", "command:execute"] });
		mocks.listChatProviders.mockResolvedValue([]);
		const element = await AiPage({ searchParams: Promise.resolve({}) });
		expect(element.props.capabilities).toMatchObject({
			canAuto: true,
			canFullAuto: false,
			canExecute: true,
			canApprove: false,
			canReadServers: false,
			isPlatformAdmin: false,
		});
	});

	it("pre-pins a ?server= deep link only when the account may reach that server", async () => {
		const pinned = await AiPage({ searchParams: Promise.resolve({ server: "srv-1" }) });
		expect(pinned.props.initialPinnedServerId).toBe("srv-1");
		expect(pinned.props.pinnedServerRejected).toBe(false);
		expect(pinned.props.servers).toEqual([{ id: "srv-1", name: "web-1", host: "10.0.0.1" }]);
		// Enabled servers in this account's reach: what PATCH /api/ai/conversations/[id] accepts as pins.
		expect(mocks.findServers).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({ enabled: true }),
			select: { id: true, name: true, host: true },
		}));

		const foreign = await AiPage({ searchParams: Promise.resolve({ server: ["srv-other", "srv-1"] }) });
		expect(foreign.props.initialPinnedServerId).toBeNull();
		expect(foreign.props.pinnedServerRejected).toBe(true);

		// A reachable server beyond the first 100 rows is resolved via targeted lookup (Astra P2-3).
		mocks.findServer.mockResolvedValueOnce({ id: "srv-150", name: "web-150", host: "10.0.0.150" });
		const beyondPage = await AiPage({ searchParams: Promise.resolve({ server: "srv-150" }) });
		expect(beyondPage.props.initialPinnedServerId).toBe("srv-150");
		expect(beyondPage.props.pinnedServerRejected).toBe(false);
		expect(beyondPage.props.servers.map((s: { id: string }) => s.id)).toContain("srv-150");
	});

	it("lists no servers (and pins none) without server:read", async () => {
		mocks.requirePagePermission.mockResolvedValue({ userId: "u3", roles: [], permissions: ["ai:chat"] });
		mocks.listChatProviders.mockResolvedValue([]);
		const element = await AiPage({ searchParams: Promise.resolve({ server: "srv-1" }) });
		expect(mocks.findServers).not.toHaveBeenCalled();
		expect(element.props.servers).toEqual([]);
		expect(element.props.initialPinnedServerId).toBeNull();
	});
});
