import { describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({ requirePagePermission: vi.fn() }));
vi.mock("@/lib/auth/page-guard", () => guard);
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => false }));
const service = vi.hoisted(() => ({ listPlaybooks: vi.fn(async () => []), listRecentPlaybookRunsForPlaybooks: vi.fn(async () => ({})) }));
vi.mock("@/lib/playbook/service", () => service);
vi.mock("@/lib/server/service", () => ({ listServerProfiles: vi.fn(async () => []) }));
vi.mock("@/lib/i18n/translations", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/i18n/translations")>()),
	getServerLocale: async () => "zh",
}));
vi.mock("../playbook-list-client", () => ({ PlaybookListClient: () => null }));

import PlaybooksPage from "../page";

describe("playbooks page", () => {
	it("is admitted by the permission to read playbooks", async () => {
		// A bare session check let every account in: one that may only read servers (the viewer role) found the
		// entry in the sidebar and a page saying there are no playbooks yet.
		guard.requirePagePermission.mockRejectedValueOnce(Object.assign(new Error("缺少权限: playbook:read"), { name: "ForbiddenError" }));
		await expect(PlaybooksPage()).rejects.toThrow("缺少权限: playbook:read");
		expect(guard.requirePagePermission).toHaveBeenCalledWith("playbook:read", { redirectTo: "/playbooks" });
		expect(service.listPlaybooks).not.toHaveBeenCalled();

		const session = { userId: "u1" };
		guard.requirePagePermission.mockResolvedValueOnce(session);
		await PlaybooksPage();
		expect(service.listPlaybooks).toHaveBeenCalledWith(session);
	});
});
