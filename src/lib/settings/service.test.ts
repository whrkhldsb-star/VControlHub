import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
	setting: {
		findMany: vi.fn(),
		findUnique: vi.fn(),
		upsert: vi.fn(),
	},
	$transaction: vi.fn(),
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

const { getAllSettingsMasked, getSettingUpdateMetadata, setManySettings, setSetting } = await import("./service");

describe("empty secrets", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prismaMock.$transaction.mockImplementation(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
	});

	it("stores an empty secret as empty, not as the encryption of nothing", async () => {
		// encrypt("") gave a value like salt:iv:tag: that read back as a 75-character "password": the settings page
		// showed "***" for a secret nobody set, and an empty Turnstile secret refused every login.
		await setSetting("smtp.pass", "");
		await setManySettings([{ key: "telegram.botToken", value: "" }, { key: "smtp.user", value: "mailer" }]);
		const stored = prismaMock.setting.upsert.mock.calls.map((call) => call[0].update.value);
		expect(stored).toEqual(["", "", "mailer"]);

		await setSetting("smtp.pass", "s3cret");
		expect(prismaMock.setting.upsert.mock.calls.at(-1)![0].update.value).toBe("encrypted:s3cret");
	});

	it("reads a row an older version stored for an empty secret as unset", async () => {
		prismaMock.setting.findMany.mockResolvedValue([
			{ key: "smtp.pass", value: "c2FsdA==:aXY=:dGFn:" },
			{ key: "telegram.botToken", value: "encrypted:123:abc" },
		]);
		const masked = await getAllSettingsMasked();
		expect(masked["smtp.pass"]).toBe("");
		expect(masked["telegram.botToken"]).toBe("***");
	});
});

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

