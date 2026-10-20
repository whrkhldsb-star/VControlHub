import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
	setting: {
		findMany: vi.fn(),
		findUnique: vi.fn(),
		upsert: vi.fn(),
	},
	auditLog: {
		findMany: vi.fn(),
	},
	user: {
		findMany: vi.fn(async (): Promise<Array<{ id: string; username: string; displayName: string | null }>> => []),
	},
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/crypto/service", () => ({
	encrypt: (value: string) => `encrypted:${value}`,
	decrypt: (value: string) => value.replace(/^encrypted:/, ""),
	isEncrypted: (value: string) => value.startsWith("encrypted:"),
}));

const { getSettingUpdateMetadata } = await import("./service");

describe("settings service audit metadata", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("maps each setting key to its latest settings.update actor and timestamp", async () => {
		const newest = new Date("2026-06-02T03:04:05Z");
		// The row is written, then its audit entry, a moment later.
		const dbUpdatedAt = new Date(newest.getTime() - 20);
		const older = new Date("2026-06-01T03:04:05Z");

		prismaMock.setting.findMany.mockResolvedValueOnce([
			{ key: "runtime.commandExecutionTimeoutMs", updatedAt: dbUpdatedAt },
		]);
		prismaMock.auditLog.findMany.mockResolvedValueOnce([
			{
				actorId: "u2",
				createdAt: newest,
				detail: { keys: ["runtime.commandExecutionTimeoutMs", "smtp.pass"] },
				actor: { username: "alice", displayName: "Alice Admin" },
			},
			{
				actorId: "u1",
				createdAt: older,
				detail: { keys: ["runtime.commandExecutionTimeoutMs"] },
				actor: { username: "old", displayName: null },
			},
		]);

		const result = await getSettingUpdateMetadata(["runtime.commandExecutionTimeoutMs", "smtp.pass", "platform.name"]);

		expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { action: "settings.update" },
			orderBy: { createdAt: "desc" },
			take: 100,
		}));
		expect(result["runtime.commandExecutionTimeoutMs"]).toEqual({
			updatedAt: dbUpdatedAt,
			actorId: "u2",
			actorName: "Alice Admin",
		});
		expect(result["smtp.pass"]).toEqual({
			updatedAt: newest,
			actorId: "u2",
			actorName: "Alice Admin",
		});
		expect(result["platform.name"]).toEqual({ updatedAt: null, actorId: null, actorName: null });
	});

	it("does not credit a newer change to the author of an older audit entry", async () => {
		// The latest save's audit write failed (audit is best effort): naming
		// the previous editor would attribute their change wrongly.
		const saved = new Date("2026-06-02T12:00:00Z");
		prismaMock.setting.findMany.mockResolvedValueOnce([{ key: "platform.name", updatedAt: saved }]);
		prismaMock.auditLog.findMany.mockResolvedValueOnce([
			{ actorId: "u-old", createdAt: new Date("2026-06-02T10:00:00Z"), detail: { keys: ["platform.name"] }, actor: { username: "old", displayName: null } },
		]);
		const result = await getSettingUpdateMetadata(["platform.name"]);
		expect(result["platform.name"]).toEqual({ updatedAt: saved, actorId: null, actorName: null });
	});

	it("names the writer recorded on the row, whatever the audit log says", async () => {
		// The newest save's audit write failed; an older entry by someone else exists.
		const saved = new Date("2026-06-02T12:00:00Z");
		prismaMock.setting.findMany.mockResolvedValueOnce([{ key: "platform.name", updatedAt: saved, updatedBy: "u-new" }]);
		prismaMock.auditLog.findMany.mockResolvedValueOnce([
			{ actorId: "u-old", createdAt: new Date("2026-06-02T11:59:58Z"), detail: { keys: ["platform.name"] }, actor: { username: "old", displayName: null } },
		]);
		prismaMock.user.findMany.mockResolvedValueOnce([{ id: "u-new", username: "new", displayName: "New Editor" }]);
		const result = await getSettingUpdateMetadata(["platform.name"]);
		expect(result["platform.name"]).toEqual({ updatedAt: saved, actorId: "u-new", actorName: "New Editor" });
	});

	it("for a row from before the writer column, never credits an audit entry written before the change", async () => {
		// Two seconds before the stored change: the earlier 5-second tolerance credited it.
		const saved = new Date("2026-06-02T12:00:00Z");
		prismaMock.setting.findMany.mockResolvedValueOnce([{ key: "platform.name", updatedAt: saved, updatedBy: null }]);
		prismaMock.auditLog.findMany.mockResolvedValueOnce([
			{ actorId: "u-old", createdAt: new Date("2026-06-02T11:59:58Z"), detail: { keys: ["platform.name"] }, actor: { username: "old", displayName: null } },
		]);
		const result = await getSettingUpdateMetadata(["platform.name"]);
		expect(result["platform.name"]).toEqual({ updatedAt: saved, actorId: null, actorName: null });
	});
});

