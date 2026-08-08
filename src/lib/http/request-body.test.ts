import { describe, expect, it } from "vitest";

import {
	readRequestBodyBuffer,
	requestContentLengthExceeds,
	RequestBodyTooLargeError,
} from "@/lib/http/request-body";

describe("bounded request body helpers", () => {
	it("reads a body up to the configured limit", async () => {
		const request = new Request("http://local/upload", {
			method: "PUT",
			body: "hello",
		});

		await expect(readRequestBodyBuffer(request, 5)).resolves.toEqual(
			Buffer.from("hello"),
		);
	});

	it("rejects an oversized streamed body even without content-length", async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(Buffer.from("1234"));
				controller.enqueue(Buffer.from("5678"));
				controller.close();
			},
		});
		const request = new Request("http://local/upload", {
			method: "PUT",
			body,
			duplex: "half",
		} as RequestInit & { duplex: "half" });

		await expect(readRequestBodyBuffer(request, 7)).rejects.toBeInstanceOf(
			RequestBodyTooLargeError,
		);
	});

	it("detects an oversized declared content length", async () => {
		const request = new Request("http://local/upload", {
			method: "PUT",
			body: "x",
			headers: { "content-length": "101" },
		});

		expect(requestContentLengthExceeds(request, 100)).toBe(true);
		await expect(readRequestBodyBuffer(request, 100)).rejects.toBeInstanceOf(
			RequestBodyTooLargeError,
		);
	});
});
