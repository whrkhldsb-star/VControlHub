import { describe, expect, it } from "vitest";

/**
 * Tests for the backup-schedule zod schemas.
 *
 * `patchBackupScheduleSchema` is a union, and union member order decides how a
 * PATCH is interpreted: a body carrying `toggleId` must land on the toggle
 * branch, while one carrying `id` must land on the update branch. If a body could
 * satisfy both, the first member wins silently — so the discriminating fields and
 * the outcome for an ambiguous body both get pinned here.
 *
 * `retentionDays` is nullable-optional on purpose: `null` means "keep forever"
 * and absent means "don't change it". Collapsing them would make an unlimited
 * retention unreachable, the same class of bug already fixed in the ITSM config
 * and announcement expiry schemas.
 */
import {
	createBackupScheduleSchema,
	patchBackupScheduleSchema,
	toggleBackupScheduleSchema,
	updateBackupScheduleSchema,
} from "../schedule-schema";

const valid = { name: "nightly", cronExpression: "0 3 * * *", backupType: "FULL" as const };

describe("createBackupScheduleSchema", () => {
	it("accepts a minimal schedule and trims the text fields", () => {
		expect(createBackupScheduleSchema.parse({ ...valid, name: "  nightly  " })).toMatchObject({ name: "nightly" });
	});

	it("requires name, cron and backupType", () => {
		expect(createBackupScheduleSchema.safeParse({}).success).toBe(false);
		expect(createBackupScheduleSchema.safeParse({ ...valid, name: "  " }).success).toBe(false);
		expect(createBackupScheduleSchema.safeParse({ ...valid, cronExpression: " " }).success).toBe(false);
	});

	it.each(["DATABASE", "FILES", "FULL"])("accepts the %s backup type", (backupType) => {
		expect(createBackupScheduleSchema.safeParse({ ...valid, backupType }).success).toBe(true);
	});

	it.each(["database", "SNAPSHOT", "", "ALL"])("rejects the backup type %s", (backupType) => {
		expect(createBackupScheduleSchema.safeParse({ ...valid, backupType }).success).toBe(false);
	});

	it("accepts null retentionDays as 'keep forever'", () => {
		expect(createBackupScheduleSchema.parse({ ...valid, retentionDays: null }).retentionDays).toBeNull();
	});

	it("distinguishes an absent retentionDays from an explicit null", () => {
		expect(createBackupScheduleSchema.parse(valid)).not.toHaveProperty("retentionDays");
	});

	it("bounds retentionDays to 1..3650 and requires an integer", () => {
		expect(createBackupScheduleSchema.safeParse({ ...valid, retentionDays: 0 }).success).toBe(false);
		expect(createBackupScheduleSchema.safeParse({ ...valid, retentionDays: 3651 }).success).toBe(false);
		expect(createBackupScheduleSchema.safeParse({ ...valid, retentionDays: 7.5 }).success).toBe(false);
		expect(createBackupScheduleSchema.safeParse({ ...valid, retentionDays: 1 }).success).toBe(true);
		expect(createBackupScheduleSchema.safeParse({ ...valid, retentionDays: 3650 }).success).toBe(true);
	});

	it("enforces the name and note length caps", () => {
		expect(createBackupScheduleSchema.safeParse({ ...valid, name: "x".repeat(101) }).success).toBe(false);
		expect(createBackupScheduleSchema.safeParse({ ...valid, note: "n".repeat(501) }).success).toBe(false);
	});
});

describe("updateBackupScheduleSchema", () => {
	it("requires only the id, everything else optional", () => {
		expect(updateBackupScheduleSchema.parse({ id: "sch_1" })).toEqual({ id: "sch_1" });
	});

	it("rejects a missing or blank id", () => {
		expect(updateBackupScheduleSchema.safeParse({}).success).toBe(false);
		expect(updateBackupScheduleSchema.safeParse({ id: "  " }).success).toBe(false);
	});

	it.each(["ACTIVE", "PAUSED", "DISABLED"])("accepts the status %s", (status) => {
		expect(updateBackupScheduleSchema.safeParse({ id: "s", status }).success).toBe(true);
	});

	it("rejects an unknown status", () => {
		expect(updateBackupScheduleSchema.safeParse({ id: "s", status: "DELETED" }).success).toBe(false);
	});

	it("still applies the field constraints inherited from create", () => {
		expect(updateBackupScheduleSchema.safeParse({ id: "s", retentionDays: 9999 }).success).toBe(false);
		expect(updateBackupScheduleSchema.safeParse({ id: "s", backupType: "nope" }).success).toBe(false);
	});
});

describe("patchBackupScheduleSchema", () => {
	it("routes a toggleId body to the toggle branch", () => {
		const parsed = patchBackupScheduleSchema.parse({ toggleId: "sch_1" });
		expect(parsed).toEqual({ toggleId: "sch_1" });
	});

	it("routes an id body to the update branch", () => {
		const parsed = patchBackupScheduleSchema.parse({ id: "sch_1", status: "PAUSED" });
		expect(parsed).toEqual({ id: "sch_1", status: "PAUSED" });
	});

	it("prefers the toggle branch when a body carries both keys", () => {
		// Union order decides, and the toggle member is first. Documented so a
		// future reorder is a visible change rather than a silent behaviour swap:
		// a body with both would otherwise switch from toggling to updating.
		const parsed = patchBackupScheduleSchema.parse({ toggleId: "sch_1", id: "sch_2", status: "DISABLED" });
		expect(parsed).toEqual({ toggleId: "sch_1" });
	});

	it("rejects a body matching neither branch", () => {
		expect(patchBackupScheduleSchema.safeParse({}).success).toBe(false);
		expect(patchBackupScheduleSchema.safeParse({ status: "PAUSED" }).success).toBe(false);
		expect(patchBackupScheduleSchema.safeParse({ toggleId: "  " }).success).toBe(false);
	});

	it("agrees with the standalone toggle schema", () => {
		expect(toggleBackupScheduleSchema.parse({ toggleId: " sch_1 " })).toEqual({ toggleId: "sch_1" });
	});
});
