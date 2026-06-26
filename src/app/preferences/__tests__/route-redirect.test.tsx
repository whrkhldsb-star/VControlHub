import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-session", () => ({
	requireSession: vi.fn().mockResolvedValue({
		userId: "u_1",
		username: "admin",
		roles: ["admin"],
		mustChangePassword: false,
	}),
}));

vi.mock("next/navigation", () => ({
	redirect: vi.fn(),
}));

import { redirect } from "next/navigation";
import PreferencesPageRoute from "../page";


describe("PreferencesPage route", () => {
	it("keeps /preferences as a compatibility route to the unified settings personal preferences section", async () => {
		try {
			await PreferencesPageRoute();
		} catch {
			// redirect() throws NEXT_REDIRECT in Next.js, which is expected.
		}

		expect(redirect).toHaveBeenCalledWith("/settings#personal-preferences");
	});
});
