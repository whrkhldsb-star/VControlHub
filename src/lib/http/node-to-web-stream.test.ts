import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";

describe("nodeStreamToWeb", () => {
	it("streams node chunks into a web stream", async () => {
		const webStream = nodeStreamToWeb(Readable.from([Buffer.from("hello"), Buffer.from(" world")]));
		const text = await new Response(webStream).text();

		expect(text).toBe("hello world");
	});

	it("does not throw when the node stream emits after the web reader is cancelled", async () => {
		const nodeStream = new Readable({ read() {} });
		const webStream = nodeStreamToWeb(nodeStream);
		const reader = webStream.getReader();
		const firstRead = reader.read();

		nodeStream.push(Buffer.from("first"));
		const firstChunk = await firstRead;
		expect(firstChunk.done).toBe(false);
		expect(Buffer.from(firstChunk.value ?? [])).toEqual(Buffer.from("first"));

		await reader.cancel();
		expect(() => {
			nodeStream.emit("data", Buffer.from("late"));
			nodeStream.emit("end");
			nodeStream.emit("close");
		}).not.toThrow();
	});
});
