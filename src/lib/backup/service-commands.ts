/**
 * Backup service — pure command builders (R28 god-file split).
 *
 * Builds the backup and type-specific restore shell
 * strings consumed by `./command-runner`. No I/O, no prisma.
 *
 * Restore policy lives in `planBackupRestoreSteps` so the UI/docs shell
 * formatter and the runtime argv executor cannot drift.
 */
import { isAbsolute, join } from "node:path";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { IS_WINDOWS } from "@/lib/runtime/platform-paths";
import { shellQuote } from "@/lib/shell-quote";
import type { BackupType } from "./service-types";
import { assertPortableBackupPath, getBackupStorageRoot } from "./service-types";
import { backupRunnerSpec, restoreRunnerSpec } from "./platform-runner";

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

/** PowerShell literal arguments (including paths with spaces, quotes or dollar signs). */
export function formatPowerShellCommand(projectRoot: string, step: BackupRestoreStep, confirm = false) {
	const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
	const invoke = "& " + [step.file, ...step.args].map(quote).join(" ");
	const environment = confirm ? "$env:CONFIRM_RESTORE='1'; $env:VCONTROLHUB_SERVICE_UNITS='none'; " : "";
	return `Set-Location -LiteralPath ${quote(projectRoot)} -ErrorAction Stop; ${environment}${invoke}`;
}

function formatRestoreStepsAsShell(projectRoot: string, steps: BackupRestoreStep[], confirm = false) {
	if (IS_WINDOWS) return steps.map((step) => formatPowerShellCommand(projectRoot, step, confirm)).join("\n");
	const parts = steps.map((step) => {
		// Invoker + script stay unquoted for readable docs; every value after
		// them (paths, components) is shell-quoted.
		const [head, script, ...rest] = [step.file, ...step.args];
		const tail = rest.map(shellQuote).join(" ");
		const invocation = tail ? `${head} ${script} ${tail}` : `${head} ${script}`;
		return confirm ? `CONFIRM_RESTORE=1 ${invocation}` : invocation;
	});
	return `cd ${shellQuote(projectRoot)} && ${parts.join(" && ")}`;
}

export function buildPortableBackupCommand(input: { projectRoot: string; outputPath: string; type?: BackupType; restoreSnapshot?: boolean }) {
	const outputPath = assertPortableBackupPath(input.outputPath);
	const modeFlag = input.type === "FILES" ? " --files" : input.type === "FULL" ? " --full" : "";
	const { file, script } = backupRunnerSpec();
	if (IS_WINDOWS) return formatPowerShellCommand(input.projectRoot, { file, args: [
		script, ...(modeFlag ? [modeFlag.trim()] : []), ...(input.restoreSnapshot ? ["--restore-snapshot"] : []),
		join(getBackupStorageRoot(input.projectRoot), outputPath),
	] });
	// Absolute, under BACKUP_DIR (A9-04): a relative path is resolved by
	// scripts/backup.mjs against the app directory, which is not where the
	// application lists, retains or uploads backups from.
	return `cd ${shellQuote(input.projectRoot)} && ${file} ${script}${modeFlag}${input.restoreSnapshot ? " --restore-snapshot" : ""} ${shellQuote(join(getBackupStorageRoot(input.projectRoot), outputPath))}`;
}

export function buildBackupRestoreCommand(input: {
	projectRoot: string;
	/** Portable path relative to the directory the command runs in. */
	backupPath: string;
	/**
	 * The archive's absolute location, resolved by the server from a validated
	 * record (BACKUP_DIR may lie outside the app directory). Used instead of
	 * `backupPath` when given.
	 */
	resolvedBackupPath?: string;
	type?: BackupType;
	component?: "database" | "files" | "all";
	/** Prefix CONFIRM_RESTORE=1 — for the runbook an operator runs offline. */
	confirm?: boolean;
}) {
	const portable = assertPortableBackupPath(input.backupPath);
	if (input.resolvedBackupPath !== undefined && !isAbsolute(input.resolvedBackupPath)) {
		throw new ValidationError(t("backend.backup.pathNotPortable"));
	}
	const backupPath = input.resolvedBackupPath ?? portable;
	const steps = planBackupRestoreSteps({
		projectRoot: input.projectRoot,
		backupPath,
		type: input.type,
		component: input.component,
	});
	return formatRestoreStepsAsShell(input.projectRoot, steps, input.confirm === true);
}
