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
		const dbUpdatedAt = new Date("2026-06-01T00:00:00Z");
		const newest = new Date("2026-06-02T03:04:05Z");
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
			updatedAt: newest,
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
});
