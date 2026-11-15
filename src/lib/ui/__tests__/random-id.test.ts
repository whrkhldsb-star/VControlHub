import { afterEach, describe, expect, it, vi } from "vitest";

import { randomId } from "../random-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomId", () => {
	afterEach(() => vi.restoreAllMocks());

	it("uses crypto.randomUUID where the page has it", () => {
		const spy = vi.spyOn(globalThis.crypto, "randomUUID");
		expect(randomId()).toMatch(UUID_V4);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	// http://<IP> is not a secure context: randomUUID is undefined there, and uploads, file moves and the AI chat
	// failed with "crypto.randomUUID is not a function".
	it("builds a version 4 UUID from getRandomValues outside a secure context", () => {
		const randomUUID = globalThis.crypto.randomUUID;
		Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
		try {
			const ids = new Set(Array.from({ length: 200 }, () => randomId()));
			expect(ids.size).toBe(200);
			for (const id of ids) expect(id).toMatch(UUID_V4);
		} finally {
			Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: randomUUID });
		}
	});
});
