import { describe, expect, it } from "vitest";

/**
 * Tests for `requirePlaybookId`, shared by every `/api/playbooks/[id]/*` route.
 *
 * It throws `ValidationError` rather than a bare `Error` so `apiCatch` maps the
 * failure to a 400 instead of the 500 a plain Error would produce — the same
 * distinction already recorded for `parseSearchParams`. That status is the
 * property worth pinning, along with the trim: an id arriving as `"%20"` must be
 * rejected rather than used as a blank lookup key.
 */
import { requirePlaybookId } from "../route-params";

describe("requirePlaybookId", () => {
	it("returns the id from the awaited params", async () => {
		await expect(requirePlaybookId(Promise.resolve({ id: "pb_1" }))).resolves.toBe("pb_1");
	});

	it("trims surrounding whitespace", async () => {
		await expect(requirePlaybookId(Promise.resolve({ id: "  pb_1  " }))).resolves.toBe("pb_1");
	});

	it.each([undefined, "", "   ", "\t\n"])("rejects the id %s with a 400-mapping error", async (id) => {
		await expect(
			requirePlaybookId(Promise.resolve({ id } as { id?: string })),
		).rejects.toMatchObject({ status: 400 });
	});

	it("names the missing field in the message", async () => {
		await expect(requirePlaybookId(Promise.resolve({}))).rejects.toThrow(/playbook id/i);
	});
});
