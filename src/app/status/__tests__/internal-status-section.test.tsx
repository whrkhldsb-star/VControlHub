import { describe, expect, it, vi } from "vitest";

const { getPublicStatusMock, getUptimeMock } = vi.hoisted(() => ({
	getPublicStatusMock: vi.fn(async () => ({ generatedAt: "2026-10-28T00:00:00.000Z", summary: { overall: "healthy" }, checks: [] })),
	getUptimeMock: vi.fn(async () => ({ servers: [] })),
}));
vi.mock("@/lib/status/service", () => ({ getPublicStatus: getPublicStatusMock }));
vi.mock("@/lib/uptime/internal", () => ({ getAllUptimeDataInternal: getUptimeMock }));
vi.mock("@/lib/i18n/translations", () => ({ getServerLocale: async () => "zh", t: (key: string) => key }));

import { InternalStatusSection } from "../internal-status-section";

const session = (roles: string[], currentTeamId: string | null) => ({ userId: "u1", username: "u", roles, currentTeamId, mustChangePassword: false }) as never;

describe("InternalStatusSection", () => {
	it("keeps the platform-wide component checks (counts of every customer's servers) for the platform's administrators", async () => {
		getPublicStatusMock.mockClear();
		await InternalStatusSection({ session: session(["admin"], null) });
		expect(getPublicStatusMock).toHaveBeenCalledOnce();
	});

	it("gives a customer account its own uptime but not those counts", async () => {
		getPublicStatusMock.mockClear();
		getUptimeMock.mockClear();
		const element = await InternalStatusSection({ session: session(["operator"], "team_1") });
		expect(getPublicStatusMock).not.toHaveBeenCalled();
		expect(getUptimeMock).toHaveBeenCalledWith({ session: expect.objectContaining({ currentTeamId: "team_1" }) });
		expect(JSON.stringify(element)).not.toContain("statusPage.overallLabel");
	});
});
