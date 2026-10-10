import { describe, expect, it, vi } from "vitest";

import { readTextPrefix } from "../read-text-prefix";

function streamResponse(chunks: Uint8Array[]) {
	const cancel = vi.fn();
	let index = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (index < chunks.length) controller.enqueue(chunks[index++]!);
			else controller.close();
		},
		cancel,
	});
	return { response: new Response(body), cancel };
}

describe("readTextPrefix", () => {
	it("returns the whole text when it fits", async () => {
		const { response, cancel } = streamResponse([new TextEncoder().encode("a,b\n1,2\n")]);
		await expect(readTextPrefix(response, 1024)).resolves.toEqual({ text: "a,b\n1,2\n", truncated: false });
		expect(cancel).not.toHaveBeenCalled();
	});

	it("stops at the byte budget, cancels the download and drops the half line and half character", async () => {
		const bytes = new TextEncoder().encode("第一行\n第二行很长");
		// Budget lands inside the multi-byte "很" of the second line.
		const { response, cancel } = streamResponse([bytes.subarray(0, 5), bytes.subarray(5)]);
		const result = await readTextPrefix(response, bytes.length - 2);
		expect(result).toEqual({ text: "第一行\n", truncated: true });
		expect(cancel).toHaveBeenCalled();
	});
});
