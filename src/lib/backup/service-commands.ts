/**
 * Backup service — pure command builders (R28 god-file split).
 *
 * Builds the backup and type-specific restore shell
 * strings consumed by `./command-runner`. No I/O, no prisma.
 *
 * Restore policy lives in `planBackupRestoreSteps` so the UI/docs shell
 * formatter and the runtime argv executor cannot drift.
 */
import { IS_WINDOWS } from "@/lib/runtime/platform-paths";
import type { BackupType } from "./service-types";
import { assertPortableBackupPath } from "./service-types";
import { backupRunnerSpec, restoreRunnerSpec } from "./platform-runner";

function shellQuote(value: string) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export type BackupRestoreStep = { file: string; args: string[] };

/**
 * Shared restore planner: type + component → argv steps.
 * `backupPath` is whatever the caller already resolved (portable relative for
 * display commands, absolute for runtime execution).
 *
 * Both platforms resolve their entrypoint through `restoreRunnerSpec`:
 * Windows dispatches on the component argument of scripts/restore.mjs, POSIX
 * gets the matching scripts/restore-*.sh — the component semantics are the
 * same either way.
 */
export function planBackupRestoreSteps(input: {
	projectRoot: string;
	backupPath: string;
	type?: BackupType;
	component?: "database" | "files" | "all";
}): BackupRestoreStep[] {
	const component = input.component ?? "all";
	// Unknown/missing type defaults to database restore on both platforms.
	const type: BackupType = input.type ?? "DATABASE";
	const { file, script } = restoreRunnerSpec(type);

	if (IS_WINDOWS) {
		// FEAT-P1: 细粒度恢复 — 允许只恢复数据库或只恢复文件
		if (type === "DATABASE") {
			return [{ file, args: [script, "database", input.backupPath] }];
		}
		if (type === "FILES") {
			return [{ file, args: [script, "files", input.backupPath, input.projectRoot] }];
		}
		return [{ file, args: [script, "full", input.backupPath, component, input.projectRoot] }];
	}

	if (type === "DATABASE") {
		return [{ file, args: [script, input.backupPath] }];
	}
	if (type === "FILES") {
		return [{ file, args: [script, input.backupPath, input.projectRoot] }];
	}
	return [{ file, args: [script, input.backupPath, component, input.projectRoot] }];
}

function formatRestoreStepsAsShell(projectRoot: string, steps: BackupRestoreStep[]) {
	const parts = steps.map((step) => {
		// Invoker + script stay unquoted for readable docs; every value after
		// them (paths, components) is shell-quoted.
		const [head, script, ...rest] = [step.file, ...step.args];
		const tail = rest.map(shellQuote).join(" ");
		return tail ? `${head} ${script} ${tail}` : `${head} ${script}`;
	});
	return `cd ${shellQuote(projectRoot)} && ${parts.join(" && ")}`;
}

export function buildPortableBackupCommand(input: { projectRoot: string; outputPath: string; type?: BackupType }) {
	const outputPath = assertPortableBackupPath(input.outputPath);
	const modeFlag = input.type === "FILES" ? " --files" : input.type === "FULL" ? " --full" : "";
	const { file, script } = backupRunnerSpec();
	const quotedScript = IS_WINDOWS ? [file, script].map(shellQuote).join(" ") : `${file} ${script}`;
	return `cd ${shellQuote(input.projectRoot)} && ${quotedScript}${modeFlag} ${shellQuote(outputPath)}`;
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
