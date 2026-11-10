/**
 * Unit tests for VPS backup presets + cron parser (TR-043)
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, it, expect } from "vitest";

import {
	buildRemoteBackupCommand,
	buildRemoteCleanupCommand,
	generateRemoteBackupPath,
	invalidCustomBackupPaths,
	VALID_PRESET_TYPES,
} from "../vps-backup-presets";
import { computeNextRun, validateVpsCronExpression } from "../vps-backup-schedule-service";
import { ValidationError } from "@/lib/errors";

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

	it("generates mysqldump command for mysql with pipefail/size guards", () => {
		const cmd = buildRemoteBackupCommand("mysql", "/tmp/vch-backup_456.tar.gz");
		expect(cmd).toContain("mysqldump");
		expect(cmd).toContain("pipefail");
		expect(cmd).toContain("test -s");
		expect(cmd).toContain("/tmp/vch-backup_456.tar.gz");
		expect(cmd).not.toContain("2>/dev/null");
	});

	it("generates pg_dump command for postgres with pipefail/size guards", () => {
		const cmd = buildRemoteBackupCommand("postgres", "/tmp/vch-backup_789.tar.gz");
		expect(cmd).toContain("pg_dumpall");
		expect(cmd).toContain("pipefail");
		expect(cmd).toContain("test -s");
		expect(cmd).toContain("/tmp/vch-backup_789.tar.gz");
		expect(cmd).not.toContain("2>/dev/null");
	});

	it("generates docker command for docker-volumes with fail-hard guards", () => {
		const cmd = buildRemoteBackupCommand("docker-volumes", "/tmp/vch-backup_docker.tar.gz");
		expect(cmd).toContain("docker");
		expect(cmd).toContain("tar");
		expect(cmd).toContain("pipefail");
		expect(cmd).toContain("test -s");
		expect(cmd).not.toContain("2>/dev/null");
	});

	it("uses custom paths when provided", () => {
		const cmd = buildRemoteBackupCommand("custom", "/tmp/vch-backup_custom.tar.gz", ["var/www", "opt/data"]);
		expect(cmd).toContain("var/www");
		expect(cmd).toContain("opt/data");
		expect(cmd).toContain("tar");
	});

	it("quotes custom paths with shell metacharacters or quotes instead of dropping or rewriting them", () => {
		// "(old) & $x" was dropped and "O'Brien" became "OBrien": the archive
		// held fewer (or other) paths than asked and the backup still succeeded.
		const cmd = buildRemoteBackupCommand("custom", "/tmp/vch-backup_custom.tar.gz", [
			"/etc/nginx",
			"/srv/data (old) & $x",
			"/home/O'Brien",
			"/-x",
		]);
		expect(cmd).toContain("-C / -- 'etc/nginx' 'srv/data (old) & $x' 'home/O'\\''Brien' '-x';");
	});

	it("refuses custom paths it cannot take as given instead of skipping them", () => {
		expect(() => buildRemoteBackupCommand("custom", "/tmp/x.tar.gz", ["/etc/nginx", "/srv/../etc/shadow"])).toThrow(/invalid/i);
		expect(invalidCustomBackupPaths(["/etc/nginx", "/srv/a\nb", "/", "/srv/file..bak", "../x"])).toEqual(["/srv/a\nb", "/", "../x"]);
	});
});

describe.skipIf(process.platform === "win32")("remote archive privacy", () => {
	// Stand-ins write the way the real tools do under an SSH login's umask 022;
	// the docker one as the container would, into the bind-mounted directory.
	const tools: Record<string, string> = {
		mysqldump: "#!/bin/sh\nprintf 'INSERT INTO users VALUES (1, \"secret\");'\n",
		pg_dumpall: "#!/bin/sh\nprintf 'CREATE ROLE app PASSWORD \"secret\";'\n",
		docker: [
			"#!/bin/sh",
			"for arg in \"$@\"; do case \"$arg\" in *:/backup) host=\"${arg%:/backup}\";; /backup/*) base=\"${arg#/backup/}\";; esac; done",
			"umask 022",
			"printf 'volume data' > \"$host/$base\"",
			"",
		].join("\n"),
	};

	it.each(["mysql", "postgres", "docker-volumes", "custom"])(
		"writes the %s archive readable by its owner only, not by every user of the VPS",
		(type) => {
			const dir = mkdtempSync(path.join(tmpdir(), "vch-preset-"));
			try {
				const bin = path.join(dir, "bin");
				mkdirSync(bin);
				for (const [name, body] of Object.entries(tools)) {
					writeFileSync(path.join(bin, name), body);
					chmodSync(path.join(bin, name), 0o755);
				}
				writeFileSync(path.join(dir, "index.html"), "<h1>site</h1>");
				const archive = path.join(dir, "vch-backup-1-abc.tar.gz");
				const command = buildRemoteBackupCommand(type, archive, [path.join(dir, "index.html")]);
				execFileSync("bash", ["-c", `umask 022; ${command}`], {
					env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}` },
					stdio: "pipe",
				});
				expect(statSync(archive).size).toBeGreaterThan(0);
				expect((statSync(archive).mode & 0o777).toString(8)).toBe("600");
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});

describe.skipIf(process.platform === "win32")("postgres preset: who runs pg_dumpall", () => {
	// A stock PostgreSQL only lets the "postgres" system user in over the local
	// socket. The stand-ins behave that way: the dump works for a login that
	// has a role (HAS_ROLE=1) or when it is run through runuser/su as postgres.
	const tools: Record<string, string> = {
		pg_dumpall: [
			"#!/bin/sh",
			"if [ \"${AS_POSTGRES:-0}\" = 1 ]; then printf 'dump by postgres'; exit 0; fi",
			"if [ \"${HAS_ROLE:-0}\" = 1 ]; then printf 'dump by login'; exit 0; fi",
			"echo 'pg_dumpall: error: FATAL:  role \"root\" does not exist' >&2; exit 1",
			"",
		].join("\n"),
		id: [
			"#!/bin/sh",
			"if [ \"$#\" = 1 ]; then echo \"${FAKE_UID:-0}\"; exit 0; fi",
			"[ \"${POSTGRES_USER_EXISTS:-1}\" = 1 ] && echo 110 && exit 0",
			"echo 'id: postgres: no such user' >&2; exit 1",
			"",
		].join("\n"),
		runuser: "#!/bin/sh\n[ \"$1 $2 $3\" = '-u postgres --' ] || exit 64\nshift 3\nAS_POSTGRES=1 exec \"$@\"\n",
	};

	function run(env: Record<string, string>) {
		const dir = mkdtempSync(path.join(tmpdir(), "vch-pg-preset-"));
		try {
			const bin = path.join(dir, "bin");
			mkdirSync(bin);
			for (const [name, body] of Object.entries(tools)) {
				writeFileSync(path.join(bin, name), body);
				chmodSync(path.join(bin, name), 0o755);
			}
			const archive = path.join(dir, "vch-backup-1-abc.tar.gz");
			const command = buildRemoteBackupCommand("postgres", archive);
			try {
				execFileSync("bash", ["-c", command], {
					env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}` },
					stdio: "pipe",
				});
			} catch (error) {
				const failure = error as { status: number; stderr: Buffer };
				return { status: failure.status, stderr: failure.stderr.toString(), dump: "" };
			}
			return { status: 0, stderr: "", dump: gunzipSync(readFileSync(archive)).toString() };
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	it("dumps as the login user when that user can connect", () => {
		expect(run({ FAKE_UID: "0", HAS_ROLE: "1" })).toMatchObject({ status: 0, dump: "dump by login" });
		expect(run({ FAKE_UID: "1000", HAS_ROLE: "1" })).toMatchObject({ status: 0, dump: "dump by login" });
	});

	it("dumps as the postgres system user when root has no database role", () => {
		// The usual managed server: root over SSH, PostgreSQL as installed.
		expect(run({ FAKE_UID: "0" })).toMatchObject({ status: 0, dump: "dump by postgres" });
	});

	it("fails with the database's own error for a login that cannot switch user", () => {
		const unprivileged = run({ FAKE_UID: "1000" });
		expect(unprivileged.status).not.toBe(0);
		expect(unprivileged.stderr).toContain('role "root" does not exist');
		const noPostgresUser = run({ FAKE_UID: "0", POSTGRES_USER_EXISTS: "0" });
		expect(noPostgresUser.status).not.toBe(0);
		expect(noPostgresUser.stderr).toContain('role "root" does not exist');
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

	it("matches daily at 3am in the application timezone", () => {
		const from = new Date("2026-01-01T00:00:00Z");
		const next = computeNextRun("0 3 * * *", from);
		expect(next.toISOString()).toBe("2026-01-01T19:00:00.000Z");
	});

	it("falls back to 24h for invalid cron (defense-in-depth for legacy rows)", () => {
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
		const from = new Date("2026-01-01T00:00:00Z");
		const next = computeNextRun("30 0 * * *", from);
		expect(next.toISOString()).toBe("2026-01-01T16:30:00.000Z");
	});
});

describe("validateVpsCronExpression", () => {
	it("accepts valid 5-field cron", () => {
		expect(validateVpsCronExpression("0 3 * * *")).toBe("0 3 * * *");
	});

	it("rejects empty and invalid expressions (write-time fail-closed)", () => {
		expect(() => validateVpsCronExpression("  ")).toThrow(ValidationError);
		expect(() => validateVpsCronExpression("invalid")).toThrow(ValidationError);
		expect(() => validateVpsCronExpression("0 3")).toThrow(ValidationError);
	});
});

describe("resolveVpsBackupFilePath", () => {
	it("accepts portable storage/vps-backups paths", async () => {
		const { resolveVpsBackupFilePath } = await import("../vps-backup-service");
		const abs = resolveVpsBackupFilePath("storage/vps-backups/srv1/mysql-rec1.tar.gz");
		// Compare in POSIX form so the assertion holds on Windows paths too.
		expect(abs.split(path.sep).join("/")).toContain("storage/vps-backups/srv1/mysql-rec1.tar.gz");
		expect(path.isAbsolute(abs)).toBe(true);
	});

	it("rejects path traversal and absolute paths", async () => {
		const { resolveVpsBackupFilePath } = await import("../vps-backup-service");
		expect(() => resolveVpsBackupFilePath("../etc/passwd")).toThrow(/portable relative path/);
		expect(() => resolveVpsBackupFilePath("/etc/passwd")).toThrow(/portable relative path/);
		expect(() => resolveVpsBackupFilePath("storage/vps-backups/../secret")).toThrow(/portable relative path/);
		expect(() => resolveVpsBackupFilePath("other/place/file.tar.gz")).toThrow(/storage\/vps-backups/);
	});
});
