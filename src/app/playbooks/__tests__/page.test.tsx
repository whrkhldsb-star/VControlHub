import { describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({ requirePagePermission: vi.fn() }));
vi.mock("@/lib/auth/page-guard", () => guard);
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => false }));
const rows = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { playbook: rows } }));
const recentRuns = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/playbook/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/playbook/service")>();
	return { ...actual, listPlaybooks: vi.fn(actual.listPlaybooks), listRecentPlaybookRunsForPlaybooks: recentRuns };
});
vi.mock("@/lib/server/service", () => ({ listServerProfiles: vi.fn(async () => []) }));
vi.mock("@/lib/i18n/translations", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/i18n/translations")>()),
	getServerLocale: async () => "zh",
}));
vi.mock("../playbook-list-client", () => ({ PlaybookListClient: () => null }));

import { listPlaybooks } from "@/lib/playbook/service";
import PlaybooksPage from "../page";

describe("playbooks page", () => {
	it("is admitted by the permission to read playbooks", async () => {
		// A bare session check let every account in: one that may only read servers (the viewer role) found the
		// entry in the sidebar and a page saying there are no playbooks yet.
		guard.requirePagePermission.mockRejectedValueOnce(Object.assign(new Error("缺少权限: playbook:read"), { name: "ForbiddenError" }));
		await expect(PlaybooksPage({})).rejects.toThrow("缺少权限: playbook:read");
		expect(guard.requirePagePermission).toHaveBeenCalledWith("playbook:read", { redirectTo: "/playbooks" });
		expect(listPlaybooks).not.toHaveBeenCalled();

		const session = { userId: "u1", currentTeamId: "team1", roles: ["viewer"] };
		rows.findMany.mockResolvedValueOnce([]);
		guard.requirePagePermission.mockResolvedValueOnce(session);
		await PlaybooksPage({});
		expect(listPlaybooks).toHaveBeenCalledWith(session, { take: 101, after: undefined });
	});

	it("passes only the safe webhook configuration across the RSC boundary for a reader", async () => {
		guard.requirePagePermission.mockResolvedValueOnce({ userId: "u1", currentTeamId: "team1", roles: ["viewer"] });
		rows.findMany.mockResolvedValueOnce([{
			id: "pb1", name: "Notify", triggerType: "cron", triggerConfig: { expression: "* * * * *" }, createdAt: new Date(),
			steps: [{ id: "s1", name: "Hook", type: "call_webhook", config: {
				url: "https://example.org/hook-secret?key=query-secret", method: "POST", headers: { auth: "header-secret" }, body: "body-secret",
			} }],
		}]);
		const page = await PlaybooksPage({});
		const props = page.props.children[0].props;
		expect(props.playbooks[0].steps[0].config).toEqual({
			host: "example.org", method: "POST", urlConfigured: true, hasHeaders: true, hasBody: true,
		});
		expect(JSON.stringify(props)).not.toContain("-secret");
	});

});
