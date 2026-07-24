/**
 * Backup service — pure command builders (R28 god-file split).
 *
 * Builds the `bash deploy/backup.sh ...` and `tar -xzf ...` shell
 * strings consumed by `./command-runner`. No I/O, no prisma.
 *
 * Restore policy lives in `planBackupRestoreSteps` so the UI/docs shell
 * formatter and the runtime argv executor cannot drift.
 */
import type { BackupType } from "./service-types";
import { assertPortableBackupPath } from "./service-types";

function shellQuote(value: string) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export type BackupRestoreStep = { file: string; args: string[] };

/**
 * Shared restore planner: type + component → argv steps.
 * `backupPath` is whatever the caller already resolved (portable relative for
 * display commands, absolute for runtime execution).
 */
export function planBackupRestoreSteps(input: {
	projectRoot: string;
	backupPath: string;
	type?: BackupType;
	component?: "database" | "files" | "all";
}): BackupRestoreStep[] {
	const component = input.component ?? "all";
	const type = input.type;

	// FEAT-P1: 细粒度恢复 — 允许只恢复数据库或只恢复文件
	if (type === "DATABASE") {
		return [{ file: "bash", args: ["scripts/restore-db.sh", input.backupPath] }];
	}
	if (type === "FILES") {
		return [{ file: "tar", args: ["-xzf", input.backupPath, "-C", input.projectRoot] }];
	}
	// FULL artifacts from deploy/backup.sh --full are app-path tars only
	// (storage/uploads/…), not PostgreSQL dumps. Never call restore-db.sh on them.
	if (type === "FULL") {
		if (component === "database") {
			throw new Error(
				"FULL backups do not include a database dump; restore component=database is not supported. Use a DATABASE backup or component=files.",
			);
		}
		// files | all: extract the tar only
		return [{ file: "tar", args: ["-xzf", input.backupPath, "-C", input.projectRoot] }];
	}
	// Unknown type: default to database restore
	return [{ file: "bash", args: ["scripts/restore-db.sh", input.backupPath] }];
}

function formatRestoreStepsAsShell(projectRoot: string, steps: BackupRestoreStep[]) {
	const parts = steps.map((step) => {
		// Keep fixed binaries/flags unquoted for readable docs; quote only path args.
		if (step.file === "bash" && step.args[0] === "scripts/restore-db.sh" && step.args.length === 2) {
			return `bash scripts/restore-db.sh ${shellQuote(step.args[1]!)}`;
		}
		if (step.file === "tar" && step.args[0] === "-xzf" && step.args[2] === "-C" && step.args.length === 4) {
			return `tar -xzf ${shellQuote(step.args[1]!)} -C ${shellQuote(step.args[3]!)}`;
		}
		const argv = [step.file, ...step.args].map(shellQuote).join(" ");
		return argv;
	});
	return `cd ${shellQuote(projectRoot)} && ${parts.join(" && ")}`;
}

export function buildPortableBackupCommand(input: { projectRoot: string; outputPath: string; type?: BackupType }) {
	const outputPath = assertPortableBackupPath(input.outputPath);
	const modeFlag = input.type === "FILES" ? " --files" : input.type === "FULL" ? " --full" : "";
	return `cd ${shellQuote(input.projectRoot)} && bash deploy/backup.sh${modeFlag} ${shellQuote(outputPath)}`;
}

export function buildBackupRestoreCommand(input: {
	projectRoot: string;
	backupPath: string;
	type?: BackupType;
	component?: "database" | "files" | "all";
}) {
	const backupPath = assertPortableBackupPath(input.backupPath);
	const steps = planBackupRestoreSteps({
		projectRoot: input.projectRoot,
		backupPath,
		type: input.type,
		component: input.component,
	});
	return formatRestoreStepsAsShell(input.projectRoot, steps);
}
