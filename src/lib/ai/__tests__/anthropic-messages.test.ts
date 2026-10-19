import { describe, expect, it } from "vitest";

import { assertImageOnlyAttachments, toAnthropicMessages } from "../anthropic-messages";
import { ValidationError } from "@/lib/errors";

describe("toAnthropicMessages", () => {
	it("turns OpenAI-style tool calls and results into tool_use / tool_result blocks", () => {
		const out = toAnthropicMessages([
			{ role: "system", content: "sys" },
			{ role: "user", content: "list servers" },
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{ id: "c1", type: "function", function: { name: "list_servers", arguments: '{"limit":2}' } },
					{ id: "c2", type: "function", function: { name: "ping", arguments: "not json" } },
				],
			},
			{ role: "tool", content: "[a,b]", tool_call_id: "c1" },
			{ role: "tool", content: "pong", tool_call_id: "c2" },
			{ role: "assistant", content: "two servers" },
		] as never);
		expect(out).toEqual([
			{ role: "user", content: [{ type: "text", text: "list servers" }] },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "c1", name: "list_servers", input: { limit: 2 } },
					{ type: "tool_use", id: "c2", name: "ping", input: {} },
				],
			},
			// Anthropic has no tool role: both results answer in one user turn.
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "c1", content: "[a,b]" },
					{ type: "tool_result", tool_use_id: "c2", content: "pong" },
				],
			},
			{ role: "assistant", content: [{ type: "text", text: "two servers" }] },
		]);
	});

	it("sends a PDF as a document block and images as image blocks", () => {
		const out = toAnthropicMessages([
			{
				role: "user",
				content: [
					{ type: "text", text: "read" },
					{ type: "image_url", image_url: { url: "data:application/pdf;base64,JVBERi0=" } },
					{ type: "image_url", image_url: { url: "data:image/png;base64,iVBO" } },
					{ type: "image_url", image_url: { url: "https://x.test/a.png" } },
				],
			},
		] as never);
		expect(out[0]!.content).toEqual([
			{ type: "text", text: "read" },
			{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBO" } },
			{ type: "image", source: { type: "url", url: "https://x.test/a.png" } },
		]);
	});

	it("refuses media Anthropic cannot read instead of mislabelling it", () => {
		expect(() =>
			toAnthropicMessages([
				{ role: "user", content: [{ type: "image_url", image_url: { url: "data:video/mp4;base64,AAAA" } }] },
			] as never),
		).toThrow(ValidationError);
	});
});

describe("assertImageOnlyAttachments", () => {
	it("accepts images and refuses a PDF sent as an image_url part", () => {
		const image = [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/" } }] }];
		expect(() => assertImageOnlyAttachments(image as never)).not.toThrow();
		const pdf = [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:application/pdf;base64,JVBERi0=" } }] }];
		expect(() => assertImageOnlyAttachments(pdf as never)).toThrow(ValidationError);
	});
});
