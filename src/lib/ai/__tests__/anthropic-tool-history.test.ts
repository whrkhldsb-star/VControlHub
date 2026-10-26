import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	postProviderChat: vi.fn(async () => new Response("{}")),
	findFirst: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { aiProvider: { findFirst: mocks.findFirst } } }));
vi.mock("../provider-http", async (importOriginal) => ({
	...(await importOriginal<typeof import("../provider-http")>()),
	postProviderChat: mocks.postProviderChat,
}));
vi.mock("../service-crud", async (importOriginal) => ({
	...(await importOriginal<typeof import("../service-crud")>()),
	safeDecryptApiKey: () => "sk-test",
}));

import { sendChatRequest } from "../service-runtime";

const toolHistory = [
	{ role: "user", content: "How full is the disk?" },
	{
		role: "assistant",
		content: "",
		tool_calls: [{ id: "call_1", type: "function", function: { name: "get_disk_usage", arguments: '{"serverId":"s1"}' } }],
	},
	{ role: "tool", content: '{"used":"71%"}', tool_call_id: "call_1" },
];
const diskTool = {
	type: "function",
	function: { name: "get_disk_usage", description: "Disk usage", parameters: { type: "object", properties: {} } },
};

function sentBody() {
	const call = (mocks.postProviderChat.mock.calls.at(-1) as unknown[])[0] as {
		body: { tools?: unknown[]; messages: Array<{ content: Array<{ type: string }> }> };
	};
	return call.body;
}

/**
 * The Messages API answers a request whose history holds tool_use or
 * tool_result blocks but which defines no tools with a 400. The answer
 * after hosted tools ran is sent without tools, as is every turn of a
 * thread whose hosting was switched off after it used tools.
 */
describe("Anthropic tool history", () => {
	beforeEach(() => {
		mocks.postProviderChat.mockClear();
		mocks.findFirst.mockResolvedValue({ id: "p1", type: "ANTHROPIC", baseUrl: "https://api.anthropic.example/v1", apiKey: "enc" });
	});

	it("sends no tool blocks in a request without tool definitions", async () => {
		await sendChatRequest({ providerId: "p1", model: "claude-x", messages: toolHistory } as never, "u1");
		const body = sentBody();
		expect(body.tools).toBeUndefined();
		const types = body.messages.flatMap((message) => message.content.map((block) => block.type));
		expect(types).not.toContain("tool_use");
		expect(types).not.toContain("tool_result");
		expect(JSON.stringify(body.messages)).toContain("71%");
	});

	it("keeps native tool blocks when the request defines its tools", async () => {
		await sendChatRequest({ providerId: "p1", model: "claude-x", messages: toolHistory, tools: [diskTool] } as never, "u1");
		const body = sentBody();
		expect(body.tools).toHaveLength(1);
		const types = body.messages.flatMap((message) => message.content.map((block) => block.type));
		expect(types).toEqual(expect.arrayContaining(["tool_use", "tool_result"]));
	});
});
