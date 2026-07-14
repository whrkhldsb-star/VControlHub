/**
 * Backup service — pure command builders (R28 god-file split).
 *
 * Builds the `bash deploy/backup.sh ...` and `tar -xzf ...` shell
 * strings consumed by `./command-runner`. No I/O, no prisma.
 */
import type { BackupType } from "./service-types";
import { assertPortableBackupPath } from "./service-types";

function shellQuote(value: string) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildPortableBackupCommand(input: { projectRoot: string; outputPath: string; type?: BackupType }) {
	const outputPath = assertPortableBackupPath(input.outputPath);
	const modeFlag = input.type === "FILES" ? " --files" : input.type === "FULL" ? " --full" : "";
	return `cd ${shellQuote(input.projectRoot)} && bash deploy/backup.sh${modeFlag} ${shellQuote(outputPath)}`;
}

export function buildScheduledBackupCommand(input: { projectRoot: string; type: BackupType }) {
	const modeFlag = input.type === "FILES" ? " --files" : input.type === "FULL" ? " --full" : "";
	return `cd ${shellQuote(input.projectRoot)} && bash deploy/backup.sh${modeFlag}`;
}

export function buildRestoreCommand(input: { projectRoot: string; backupPath: string }) {
	const backupPath = assertPortableBackupPath(input.backupPath);
	return `cd ${shellQuote(input.projectRoot)} && bash scripts/restore-db.sh ${shellQuote(backupPath)}`;
}

export function buildBackupRestoreCommand(input: { projectRoot: string; backupPath: string; type?: BackupType; component?: "database" | "files" | "all" }) {
	const backupPath = assertPortableBackupPath(input.backupPath);
	const component = input.component ?? "all";
	const type = input.type;

	// FEAT-P1: 细粒度恢复 — 允许只恢复数据库或只恢复文件
	if (type === "DATABASE") {
		return `cd ${shellQuote(input.projectRoot)} && bash scripts/restore-db.sh ${shellQuote(backupPath)}`;
	}
	if (type === "FILES") {
		return `cd ${shellQuote(input.projectRoot)} && tar -xzf ${shellQuote(backupPath)} -C ${shellQuote(input.projectRoot)}`;
	}
	if (type === "FULL") {
		if (component === "database") {
			return `cd ${shellQuote(input.projectRoot)} && bash scripts/restore-db.sh ${shellQuote(backupPath)}`;
		}
		if (component === "files") {
			return `cd ${shellQuote(input.projectRoot)} && tar -xzf ${shellQuote(backupPath)} -C ${shellQuote(input.projectRoot)}`;
		}
		// all: restore database first, then extract files
		return `cd ${shellQuote(input.projectRoot)} && bash scripts/restore-db.sh ${shellQuote(backupPath)} && tar -xzf ${shellQuote(backupPath)} -C ${shellQuote(input.projectRoot)}`;
	}
	// Unknown type: default to database restore
	return `cd ${shellQuote(input.projectRoot)} && bash scripts/restore-db.sh ${shellQuote(backupPath)}`;
}
