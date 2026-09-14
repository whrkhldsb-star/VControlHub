import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentSession, redirect } = vi.hoisted(() => ({
	getCurrentSession: vi.fn(),
	redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
}));
vi.mock("@/lib/auth/server-session", () => ({ getCurrentSession }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ cookies: () => { throw new Error("Page guard must not mutate cookies"); } }));

import { requireSession } from "../require-session";

describe("requireSession", () => {
	beforeEach(() => { vi.clearAllMocks(); });
	it("redirects an invalid session without attempting to modify read-only cookies", async () => {
		getCurrentSession.mockResolvedValue(null);
		await expect(requireSession("/files?path=reports")).rejects.toThrow("redirect:/login?next=%2Ffiles%3Fpath%3Dreports");
	});
	it("returns the shared verified session", async () => {
		const session = { userId: "u1", mustChangePassword: false };
		getCurrentSession.mockResolvedValue(session);
		expect(await requireSession()).toBe(session);
		expect(redirect).not.toHaveBeenCalled();
	});
	it("keeps the mandatory password change gate", async () => {
		getCurrentSession.mockResolvedValue({ userId: "u1", mustChangePassword: true });
		await expect(requireSession("/servers")).rejects.toThrow("redirect:/account/password");
		expect(await requireSession("/account/password")).toMatchObject({ mustChangePassword: true });
	});
});
