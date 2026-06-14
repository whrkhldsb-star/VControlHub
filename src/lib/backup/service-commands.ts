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

export function buildBackupRestoreCommand(input: { projectRoot: string; backupPath: string; type?: BackupType }) {
	const backupPath = assertPortableBackupPath(input.backupPath);
	if (input.type === "FILES" || input.type === "FULL") {
		return `cd ${shellQuote(input.projectRoot)} && tar -xzf ${shellQuote(backupPath)} -C ${shellQuote(input.projectRoot)}`;
	}
	return `cd ${shellQuote(input.projectRoot)} && bash scripts/restore-db.sh ${shellQuote(backupPath)}`;
}
