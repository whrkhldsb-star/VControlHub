/**
 * Unit tests for VPS backup presets + cron parser (TR-043)
 */
import { describe, it, expect } from "vitest";

import {
	buildRemoteBackupCommand,
	buildRemoteCleanupCommand,
	generateRemoteBackupPath,
	VALID_PRESET_TYPES,
} from "../vps-backup-presets";
import { computeNextRun } from "../vps-backup-schedule-service";

// ── Preset tests ────────────────────────────────────────────

describe("VALID_PRESET_TYPES", () => {
	it("includes all 6 preset types", () => {
		expect(VALID_PRESET_TYPES).toHaveLength(6);
		expect(VALID_PRESET_TYPES).toContain("nginx-config");
		expect(VALID_PRESET_TYPES).toContain("mysql");
		expect(VALID_PRESET_TYPES).toContain("postgres");
		expect(VALID_PRESET_TYPES).toContain("docker-volumes");
		expect(VALID_PRESET_TYPES).toContain("website-files");
		expect(VALID_PRESET_TYPES).toContain("custom");
	});
});

describe("buildRemoteBackupCommand", () => {
	it("generates tar command for nginx-config", () => {
		const cmd = buildRemoteBackupCommand("nginx-config", "/tmp/vch-backup_123.tar.gz");
		expect(cmd).toContain("tar");
		expect(cmd).toContain("etc/nginx");
		expect(cmd).toContain("/tmp/vch-backup_123.tar.gz");
	});

	it("generates mysqldump command for mysql", () => {
		const cmd = buildRemoteBackupCommand("mysql", "/tmp/vch-backup_456.tar.gz");
		expect(cmd).toContain("mysqldump");
		expect(cmd).toContain("tar");
		expect(cmd).toContain("/tmp/vch-backup_456.tar.gz");
	});

	it("generates pg_dump command for postgres", () => {
		const cmd = buildRemoteBackupCommand("postgres", "/tmp/vch-backup_789.tar.gz");
		expect(cmd).toContain("pg_dumpall");
		expect(cmd).toContain("tar");
		expect(cmd).toContain("/tmp/vch-backup_789.tar.gz");
	});

	it("generates docker command for docker-volumes", () => {
		const cmd = buildRemoteBackupCommand("docker-volumes", "/tmp/vch-backup_docker.tar.gz");
		expect(cmd).toContain("docker");
		expect(cmd).toContain("tar");
	});

	it("uses custom paths when provided", () => {
		const cmd = buildRemoteBackupCommand("custom", "/tmp/vch-backup_custom.tar.gz", ["var/www", "opt/data"]);
		expect(cmd).toContain("var/www");
		expect(cmd).toContain("opt/data");
		expect(cmd).toContain("tar");
	});
});

describe("buildRemoteCleanupCommand", () => {
	it("generates rm command for the remote path", () => {
		const cmd = buildRemoteCleanupCommand("/tmp/vch-backup_clean.tar.gz");
		expect(cmd).toContain("rm");
		expect(cmd).toContain("/tmp/vch-backup_clean.tar.gz");
	});
});

describe("generateRemoteBackupPath", () => {
	it("generates a path with vch-backup prefix and .tar.gz extension", () => {
		const path = generateRemoteBackupPath();
		expect(path).toMatch(/^\/tmp\/vch-backup-.*\.tar\.gz$/);
	});
});

// ── Cron parser tests ───────────────────────────────────────

describe("computeNextRun", () => {
	it("returns a date within the next 7 days", () => {
		const from = new Date("2026-01-01T00:00:00Z");
		const next = computeNextRun("0 3 * * *", from);
		expect(next.getTime()).toBeGreaterThan(from.getTime());
		expect(next.getTime()).toBeLessThan(from.getTime() + 7 * 24 * 60 * 60 * 1000);
	});

	it("matches daily at 3am (local time)", () => {
		const from = new Date("2026-01-01T00:00:00");
		const next = computeNextRun("0 3 * * *", from);
		expect(next.getHours()).toBe(3);
		expect(next.getMinutes()).toBe(0);
	});

	it("falls back to 24h for invalid cron", () => {
		const from = new Date("2026-01-01T00:00:00Z");
		const next = computeNextRun("invalid", from);
		expect(next.getTime()).toBeCloseTo(from.getTime() + 24 * 60 * 60 * 1000, -2);
	});

	it("falls back for too few fields", () => {
		const from = new Date("2026-01-01T00:00:00Z");
		const next = computeNextRun("0 3", from);
		expect(next.getTime()).toBeCloseTo(from.getTime() + 24 * 60 * 60 * 1000, -2);
	});

	it("matches minute field", () => {
		const from = new Date("2026-01-01T00:00:00");
		const next = computeNextRun("30 0 * * *", from);
		expect(next.getMinutes()).toBe(30);
		expect(next.getHours()).toBe(0);
	});
});

describe("resolveVpsBackupFilePath", () => {
	it("accepts portable storage/vps-backups paths", async () => {
		const { resolveVpsBackupFilePath } = await import("../vps-backup-service");
		const abs = resolveVpsBackupFilePath("storage/vps-backups/srv1/mysql-rec1.tar.gz");
		expect(abs).toContain("storage/vps-backups/srv1/mysql-rec1.tar.gz");
		expect(abs.startsWith("/")).toBe(true);
	});

	it("rejects path traversal and absolute paths", async () => {
		const { resolveVpsBackupFilePath } = await import("../vps-backup-service");
		expect(() => resolveVpsBackupFilePath("../etc/passwd")).toThrow(/portable relative path/);
		expect(() => resolveVpsBackupFilePath("/etc/passwd")).toThrow(/portable relative path/);
		expect(() => resolveVpsBackupFilePath("storage/vps-backups/../secret")).toThrow(/portable relative path/);
		expect(() => resolveVpsBackupFilePath("other/place/file.tar.gz")).toThrow(/storage\/vps-backups/);
	});
});
