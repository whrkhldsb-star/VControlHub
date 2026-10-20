import { describe, expect, it, vi } from "vitest";

/**
 * Tests for `buildAiChatMessagePayload` — the function that turns a stored
 * conversation plus the new request body into the message array sent to the
 * provider.
 *
 * The property the module's own closing comment calls out: base64 image data is
 * provider-only and must never end up in `allImageUrls`, because that is what the
 * caller persists as chat history. Inlining a data: URL there would write whole
 * images into the database on every turn.
 *
 * Beyond that, two shape rules matter. Tool-call plumbing (`tool_call_id`,
 * `tool_calls`) has to survive the round-trip or the provider rejects the turn
 * with an orphaned tool response, and images must be dropped entirely for a
 * non-vision model rather than sent as an unsupported content array. The
 * `toolCalls` column is free-form JSON text, so a malformed value has to degrade
 * to "no tool calls" instead of throwing mid-request.
 */
vi.mock("@/lib/i18n/service-translations", () => ({
	t: (key: string) => (key === "apiAiChat.attachmentPrefix" ? "\n\n[attachments]\n\n" : key),
}));

import { buildAiChatMessagePayload } from "../chat-message-payload";

type Conv = Parameters<typeof buildAiChatMessagePayload>[0]["conv"];

function conv(messages: Array<Record<string, unknown>>, systemPrompt: string | null = null): Conv {
	return { systemPrompt, messages } as unknown as Conv;
}

function build(input: {
	body?: Record<string, unknown>;
	conv?: Conv;
	isVisionCapable?: boolean;
}) {
	return buildAiChatMessagePayload({
		body: (input.body ?? {}) as never,
		conv: input.conv ?? conv([]),
		isVisionCapable: input.isVisionCapable ?? false,
		locale: "zh",
	});
}

describe("buildAiChatMessagePayload", () => {
	it("puts the conversation's system prompt first", () => {
		const { historyMessages } = build({ conv: conv([], "You are an ops assistant") });
		expect(historyMessages[0]).toEqual({ role: "system", content: "You are an ops assistant" });
	});

	it("drops stored system messages so only the conversation prompt sets the role", () => {
		const { historyMessages } = build({
			conv: conv([{ role: "system", content: "injected" }, { role: "user", content: "hi" }]),
		});
		expect(historyMessages.filter((m) => m.role === "system")).toHaveLength(0);
	});

	it("preserves tool_call_id on a stored tool result", () => {
		// Without it the provider sees an orphaned tool message and rejects the turn.
		const call = { id: "call_1", type: "function", function: { name: "list_servers", arguments: "{}" } };
		const { historyMessages } = build({
			conv: conv([
				{ role: "user", content: "list them" },
				{ role: "assistant", content: "", toolCalls: JSON.stringify([call]) },
				{ role: "tool", content: '{"ok":true}', toolCallId: "call_1" },
			]),
		});
		expect(historyMessages[2]).toEqual({ role: "tool", content: '{"ok":true}', tool_call_id: "call_1" });
	});

	it("drops a tool result whose call is outside the history window (or has no id)", () => {
		// The window is the latest N rows: it can start with results whose
		// assistant call was cut off, and providers reject such a result.
		const { historyMessages } = build({
			conv: conv([
				{ role: "tool", content: "orphan", toolCallId: "call_0" },
				{ role: "tool", content: "no id", toolCallId: "" },
				{ role: "user", content: "next" },
			]),
		});
		expect(historyMessages.filter((m) => m.role === "tool")).toEqual([]);
	});

	it("re-attaches an assistant turn's tool_calls", () => {
		const toolCalls = [{ id: "call_1", type: "function", function: { name: "list_servers", arguments: "{}" } }];
		const { historyMessages } = build({
			conv: conv([
				{ role: "user", content: "list them" },
				{ role: "assistant", content: "", toolCalls: JSON.stringify(toolCalls) },
				{ role: "tool", content: "{}", toolCallId: "call_1" },
			]),
		});
		expect(historyMessages[1]).toEqual({ role: "assistant", content: "", tool_calls: toolCalls });
	});

	it("replays only the tool calls that got a result", () => {
		// A call to an unknown tool, or one whose recording failed, had no result;
		// replayed, it made the provider reject every later request of the thread.
		const answered = { id: "call_ok", type: "function", function: { name: "list_servers", arguments: "{}" } };
		const orphan = { id: "call_lost", type: "function", function: { name: "made_up_tool", arguments: "{}" } };
		const { historyMessages } = build({
			body: { content: "again" },
			conv: conv([
				{ role: "user", content: "check" },
				{ role: "assistant", content: "checking", toolCalls: JSON.stringify([answered, orphan]) },
				{ role: "tool", content: "{}", toolCallId: "call_ok" },
				{ role: "assistant", content: "", toolCalls: JSON.stringify([{ ...orphan, id: "call_lost_2" }]) },
				{ role: "user", content: "next" },
			]),
		});
		expect(historyMessages).toEqual([
			{ role: "user", content: "check" },
			{ role: "assistant", content: "checking", tool_calls: [answered] },
			{ role: "tool", content: "{}", tool_call_id: "call_ok" },
			{ role: "user", content: "next" },
			{ role: "user", content: "again" },
		]);
	});

	it("starts the history at the first user turn when the window opens mid-thread", () => {
		// The latest-N window can begin on an assistant turn (and its results);
		// Anthropic rejects a history whose first message is not the user's.
		const call = { id: "call_cut", type: "function", function: { name: "list_servers", arguments: "{}" } };
		const { historyMessages } = build({
			body: { content: "again" },
			conv: conv([
				{ role: "assistant", content: "", toolCalls: JSON.stringify([call]) },
				{ role: "tool", content: "{}", toolCallId: "call_cut" },
				{ role: "assistant", content: "done" },
				{ role: "user", content: "next" },
			]),
		});
		expect(historyMessages).toEqual([{ role: "user", content: "next" }, { role: "user", content: "again" }]);
	});

	it("treats malformed stored toolCalls as no tool calls instead of throwing", () => {
		// The column is free-form text; a parse error must not fail the request.
		for (const raw of ["not json", "{}", "null", ""]) {
			const { historyMessages } = build({
				conv: conv([{ role: "user", content: "hi" }, { role: "assistant", content: "hello", toolCalls: raw }]),
			});
			expect(historyMessages[1]).toEqual({ role: "assistant", content: "hello" });
		}
	});

	it("expands a stored user turn's images into a content array for a vision model", () => {
		const { historyMessages } = build({
			conv: conv([{ role: "user", content: "what is this", imageUrls: JSON.stringify(["https://x.test/a.png"]) }]),
			isVisionCapable: true,
		});
		expect(historyMessages[0]!.content).toEqual([
			{ type: "text", text: "what is this" },
			{ type: "image_url", image_url: { url: "https://x.test/a.png" } },
		]);
	});

	it("sends plain text for a stored image turn when the model has no vision", () => {
		const { historyMessages } = build({
			conv: conv([{ role: "user", content: "what is this", imageUrls: JSON.stringify(["https://x.test/a.png"]) }]),
			isVisionCapable: false,
		});
		expect(historyMessages[0]).toEqual({ role: "user", content: "what is this" });
	});

	it("trims the new user text and appends it last", () => {
		const { historyMessages, userText } = build({ body: { content: "  restart nginx  " } });
		expect(userText).toBe("restart nginx");
		expect(historyMessages.at(-1)).toEqual({ role: "user", content: "restart nginx" });
	});

	it("inlines file attachments into the prompt with a delimiter naming each file", () => {
		const { historyMessages, userText } = build({
			body: { content: "review this", fileAttachments: [{ name: "nginx.conf", content: "server {}" }] },
		});
		const content = historyMessages.at(-1)!.content as string;
		expect(content).toContain("--- File: nginx.conf ---");
		expect(content).toContain("server {}");
		expect(content).toContain("--- End of nginx.conf ---");
		// `userText` is what gets persisted as the user's message; it must stay the
		// typed text, not the text plus a whole config file.
		expect(userText).toBe("review this");
	});

	it("keeps base64 images out of allImageUrls so they are never persisted", () => {
		// The regression this guards: writing data: URLs into chat history puts
		// whole images in the database on every turn.
		const { allImageUrls, historyMessages } = build({
			body: {
				content: "look",
				imageUrls: ["https://x.test/a.png"],
				imageBase64: [{ mimeType: "image/png", data: "AAAA" }],
			},
			isVisionCapable: true,
		});
		expect(allImageUrls).toEqual(["https://x.test/a.png"]);
		const parts = historyMessages.at(-1)!.content as Array<{ image_url?: { url: string } }>;
		expect(parts.some((p) => p.image_url?.url === "data:image/png;base64,AAAA")).toBe(true);
	});

	it("ignores new images entirely for a non-vision model", () => {
		const { allImageUrls, historyMessages } = build({
			body: { content: "look", imageUrls: ["https://x.test/a.png"] },
			isVisionCapable: false,
		});
		// The URL is still recorded as part of the user's message…
		expect(allImageUrls).toEqual(["https://x.test/a.png"]);
		// …but the outgoing turn is plain text, not an unsupported content array.
		expect(typeof historyMessages.at(-1)!.content).toBe("string");
	});

	it("handles a body with no content at all", () => {
		const { userText, historyMessages } = build({});
		expect(userText).toBe("");
		expect(historyMessages.at(-1)).toEqual({ role: "user", content: "" });
	});

	it("keeps the stored turns in order ahead of the new one", () => {
		const { historyMessages } = build({
			conv: conv([
				{ role: "user", content: "first" },
				{ role: "assistant", content: "second" },
			]),
			body: { content: "third" },
		});
		expect(historyMessages.map((m) => m.content)).toEqual(["first", "second", "third"]);
	});

	it("persists the text the model saw, attached file contents included", () => {
		// The next turn is rebuilt from the database: storing only the typed
		// text left the model unable to refer back to the file.
		const { userText, persistedText } = build({
			body: { content: "summarise", fileAttachments: [{ name: "a.log", content: "line 1" }] },
		});
		expect(userText).toBe("summarise");
		expect(persistedText).toBe("summarise\n\n[attachments]\n\n--- File: a.log ---\nline 1\n--- End of a.log ---");
	});
});
