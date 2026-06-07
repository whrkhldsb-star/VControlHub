import { describe, expect, it, vi } from "vitest";

import { fetchSourceApps } from "../adapters";

describe("Quick Services app-source fetch URL boundaries", () => {
	it("rejects private catalog URLs before fetch", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await expect(fetchSourceApps("local", "json", "http://localhost/apps.json")).rejects.toThrow(/公网 HTTP\(S\)/);
		expect(fetchSpy).not.toHaveBeenCalled();

		fetchSpy.mockRestore();
	});
});
