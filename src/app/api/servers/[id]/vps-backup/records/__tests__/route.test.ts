import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	serverFindUnique: vi.fn(),
	createVpsBackupRecord: vi.fn(),
	enqueueJob: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
	requireApiSession: vi.fn(async () => ({ userId: "u1", username: "admin", roles: ["admin"], currentTeamId: "team_1" })),
	isSessionPayload: (value: unknown) => Boolean(value && typeof value === "object" && "userId" in value),
}));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => true }));
vi.mock("@/lib/server/team-access", () => ({ assertServerTeamAccess: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/db", () => ({ prisma: { server: { findUnique: mocks.serverFindUnique } } }));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn(async () => undefined) }));
vi.mock("@/lib/backup/vps-backup-service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/backup/vps-backup-service")>()),
	createVpsBackupRecord: mocks.createVpsBackupRecord,
}));

import { POST } from "../route";

const params = { params: Promise.resolve({ id: "srv_win" }) };

describe("POST /api/servers/[id]/vps-backup/records", () => {
	beforeEach(() => vi.clearAllMocks());

	it("refuses a backup of a Windows node: the presets are POSIX shell", async () => {
		mocks.serverFindUnique.mockResolvedValueOnce({ id: "srv_win", name: "win", enabled: true, teamId: "team_1", operatingSystem: "WINDOWS" });

		const response = await POST(
			new Request("http://local/api/servers/srv_win/vps-backup/records", { method: "POST", body: JSON.stringify({ backupType: "website-files" }) }),
			params,
		);

		expect(response.status).toBe(400);
		expect(mocks.createVpsBackupRecord).not.toHaveBeenCalled();
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
	});
});
