import { describe, expect, it } from "vitest";

import {
	readResponseTextLimited,
	ResponseBodyTooLargeError,
} from "@/lib/http/response-body";

describe("bounded response body reader", () => {
	it("reads a response up to its configured limit", async () => {
		await expect(
			readResponseTextLimited(new Response("hello"), 5),
		).resolves.toBe("hello");
	});

	it("rejects a streamed response that crosses the limit", async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(Buffer.from("1234"));
				controller.enqueue(Buffer.from("5678"));
				controller.close();
			},
		});

		await expect(
			readResponseTextLimited(new Response(body), 7),
		).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
	});

	it("rejects an oversized declared response before reading", async () => {
		const response = new Response("x", {
			headers: { "content-length": "101" },
		});
		await expect(readResponseTextLimited(response, 100)).rejects.toBeInstanceOf(
			ResponseBodyTooLargeError,
		);
	});
});
