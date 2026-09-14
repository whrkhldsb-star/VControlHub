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

	it("bounds read-ahead when the client is not consuming the body", async () => {
		let produced = 0;
		const source = new Readable({
			highWaterMark: 64 * 1024,
			read() {
				if (produced === 100) { this.push(null); return; }
				produced += 1;
				this.push(Buffer.alloc(64 * 1024));
			},
		});
		const response = nodeStreamToWeb(source);
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(produced).toBeLessThanOrEqual(4);
		await response.cancel();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(source.destroyed).toBe(true);
	});

	it("encodes string chunks and propagates source failures", async () => {
		expect(await new Response(nodeStreamToWeb(Readable.from(["中文", " text"]))).text()).toBe("中文 text");
		const source = new Readable({ read() { this.destroy(new Error("read failed")); } });
		await expect(new Response(nodeStreamToWeb(source)).text()).rejects.toThrow("read failed");
	});
});
