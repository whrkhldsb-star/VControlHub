import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteBackupScheduleMock, auditUserActionMock } = vi.hoisted(() => ({
	deleteBackupScheduleMock: vi.fn(),
	auditUserActionMock: vi.fn(),
}));

vi.mock("@/lib/backup/schedule-service", () => ({ deleteBackupSchedule: deleteBackupScheduleMock }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: auditUserActionMock }));
vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: vi.fn().mockResolvedValue({ session: { userId: "u1", username: "admin", roles: ["admin"] } }),
}));

const route = await import("../route");

describe("DELETE /api/backup-schedules/[id]", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		deleteBackupScheduleMock.mockResolvedValue({ success: true });
	});

	it("reads the schedule id from the dynamic path params", async () => {
		const response = await route.DELETE(
			new Request("http://local/api/backup-schedules/schedule-1", { method: "DELETE" }),
			{ params: Promise.resolve({ id: "schedule-1" }) },
		);
		expect(response.status).toBe(200);
		expect(deleteBackupScheduleMock).toHaveBeenCalledWith("schedule-1");
	});
});
