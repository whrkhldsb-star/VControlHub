/**
 * Sentences that background processes store as text, said in the reader's language when they are shown: what
 * a job is doing or why it failed, a scheduled task's last result, why a backup was given up.
 *
 * A worker has no reader. It wrote English literals ("Stale PENDING job abandoned after 7d without claim"), or
 * a dictionary sentence in the language of the moment (the platform's default in the worker, the requester's
 * in a request), so a Chinese page showed English and an English page Chinese. What is stored is unchanged:
 * a sentence recognised here is said again in the reader's language, and anything else (a command's own
 * output, an error from a remote system) is shown as stored.
 */
import { type Locale } from "./core";
import { currentCopyLocale } from "./api-copy";
import { serviceTranslations, t as serviceT } from "./service-translations";

type Render = (match: RegExpMatchArray, locale: Locale, depth: number) => string;

const say = (key: string, params: (match: RegExpMatchArray) => Record<string, string> = () => ({})): Render =>
	(match, locale) => serviceT(key, locale, params(match));

/** The English sentences the platform writes as literals, by their stored form. Order matters: specific first. */
const ENGLISH_FORMS: Array<[RegExp, Render]> = [
	// Scheduled tasks (src/lib/scheduled-task) and backup schedules (src/lib/backup/schedule-*).
	[/^Completed command request (\S+)$/, say("backend.stored.commandRequestCompleted", (m) => ({ id: m[1]! }))],
	[
		/^Execution failed: command request (\S+) ended as (COMPLETED|FAILED|REJECTED|CANCELLED)$/,
		(m, locale) => serviceT("backend.stored.commandRequestEnded", locale, { id: m[1]!, status: serviceT(`backend.stored.commandStatus.${m[2]}`, locale) }),
	],
	[/^Execution failed: ([\s\S]+)$/, (m, locale, depth) => serviceT("backend.stored.executionFailed", locale, { message: localizeAt(m[1]!, locale, depth + 1) })],
	[/^Backup task (\S+) triggered \(job (\S+)\)$/, say("backend.stored.backupTriggered", (m) => ({ id: m[1]!, job: m[2]! }))],
	[/^Skipped: invalid backup type (\S+)$/, say("backend.stored.backupTypeInvalid", (m) => ({ type: m[1]! }))],
	// Why a task's creator may no longer run commands (src/lib/auth/command-execution-authz.ts).
	[/^command requester is disabled or no longer valid$/, say("backend.stored.requester.inactive")],
	[/^command target has no customer$/, say("backend.stored.requester.noCustomer")],
	[/^command requester is no longer a member of the target team$/, say("backend.stored.requester.notMember")],
	[/^command requester lacks command:execute permission$/, say("backend.stored.requester.noExecute")],
	[/^command requester lacks command:execute permission in the target team$/, say("backend.stored.requester.noExecuteInTeam")],
	[/^command target is disabled or no longer accessible to the requester$/, say("backend.stored.requester.targetUnavailable")],
	// Records given up by the maintenance sweeps.
	[/^Stale PENDING job abandoned after 7d without claim$/, say("backend.stored.jobPendingTooLong")],
	[/^Orphan job type cancelled \(no consumer\): (.+)$/, say("backend.stored.jobTypeWithoutWorker", (m) => ({ type: m[1]! }))],
	[/^Stale PENDING backup abandoned after 24h without worker claim$/, say("backend.stored.backupPendingTooLong")],
	[/^Stale PENDING backup abandoned after timeout$/, say("backend.stored.backupPendingTimeout")],
	[/^Stale RUNNING backup abandoned after worker timeout$/, say("backend.stored.backupWorkerLost")],
	[/^Stale RUNNING VPS backup abandoned after worker timeout$/, say("backend.stored.vpsBackupWorkerLost")],
	// Jobs that could not run.
	[/^Backup record not found or outside job team scope$/, say("backend.stored.backupRecordMissing")],
	[
		/^Backup finished with status (FAILED|VOIDED|PENDING|RUNNING)$/,
		(m, locale) => serviceT("backend.stored.backupEndedAs", locale, { status: serviceT(`backend.stored.backupStatus.${m[1]}`, locale) }),
	],
	[/^Missing recordId in job payload$/, say("backend.stored.vpsBackupRecordMissing")],
	[/^Download task (\S+) does not exist$/, say("backend.stored.downloadMissing", (m) => ({ id: m[1]! }))],
	[/^Download task (\S+) is missing a VPS node$/, say("backend.stored.downloadWithoutServer", (m) => ({ id: m[1]! }))],
	// What a running job is doing (the `progress` of heartbeatJob). A node's name has no colon: "Syncing failed:
	// …" is someone else's sentence and stays as it is.
	[/^Collecting system health signals$/, say("backend.stored.progress.healthSignals")],
	[/^Running AI operations scan$/, say("backend.stored.progress.aiOpsScan")],
	[/^Cleaning up old backups$/, say("backend.stored.progress.backupCleanup")],
	[/^Running non-destructive restore drill$/, say("backend.stored.progress.backupDrill")],
	[/^Uploading pending offsite backups$/, say("backend.stored.progress.offsiteUpload")],
	[/^Verifying backup checksum and archive format$/, say("backend.stored.progress.backupVerify")],
	[/^Running (DATABASE|FILES|FULL) backup$/, (m, locale) => serviceT(`backend.stored.progress.backup.${m[1]}`, locale)],
	[/^Dispatching due backup schedules$/, say("backend.stored.progress.backupSchedules")],
	[/^Running VPS backup$/, say("backend.stored.progress.vpsBackup")],
	[/^Dispatching command request (\S+)$/, say("backend.stored.progress.commandDispatch", (m) => ({ id: m[1]! }))],
	[/^Executing command request (\S+)$/, say("backend.stored.progress.commandExecute", (m) => ({ id: m[1]! }))],
	[/^Syncing VPS monthly fees and aggregating daily cost$/, say("backend.stored.progress.costSync")],
	[/^Ensuring default alert rules$/, say("backend.stored.progress.defaultAlertRules")],
	[/^Evaluating alert rules$/, say("backend.stored.progress.alertEvaluation")],
	[/^Collecting fleet metrics$/, say("backend.stored.progress.fleetMetrics")],
	[/^Delivering ITSM event$/, say("backend.stored.progress.itsmDelivery")],
	[/^Sampling local and remote traffic counters$/, say("backend.stored.progress.trafficAll")],
	[/^Sampling traffic counters$/, say("backend.stored.progress.traffic")],
	[/^Pruning historical records across sources$/, say("backend.stored.progress.taskRetention")],
	[/^Dispatching due Playbook Cron triggers$/, say("backend.stored.progress.playbookTriggers")],
	[/^Dispatching due scheduled tasks$/, say("backend.stored.progress.scheduledTasks")],
	[/^Scanning ([^:\n]+) \((\d+)\/(\d+)\)$/, say("backend.stored.progress.scanNodeOf", (m) => ({ node: m[1]!, index: m[2]!, total: m[3]! }))],
	[/^Scanning ([^:\n]+)$/, say("backend.stored.progress.scanNode", (m) => ({ node: m[1]! }))],
	[/^Loading SFTP nodes$/, say("backend.stored.progress.sftpNodes")],
	[/^Syncing ([^:\n]+)$/, say("backend.stored.progress.syncNode", (m) => ({ node: m[1]! }))],
	[/^Checking ticket SLA deadlines$/, say("backend.stored.progress.ticketSla")],
	// Written before downloads said it in the platform's language.
	[/^Starting download\.\.\.$/, say("backend.downloads.progress.directStarting")],
	[/^Preparing to execute QuickService (install|start|stop|sync|update|uninstall): (\S+)$/, (m, locale) => serviceT(`backend.stored.progress.qsPrepare.${m[1]}`, locale, { slug: m[2]! })],
	[/^Installing (\S+) on (.+): pulling image and creating container$/, say("backend.stored.progress.qsInstall", (m) => ({ slug: m[1]!, instance: m[2]! }))],
	[/^Starting (\S+): starting or recreating container$/, say("backend.stored.progress.qsStart", (m) => ({ slug: m[1]! }))],
	[/^Stopping (\S+): stopping Docker container$/, say("backend.stored.progress.qsStop", (m) => ({ slug: m[1]! }))],
	[/^Refreshing (\S+): reading Docker container status$/, say("backend.stored.progress.qsRefresh", (m) => ({ slug: m[1]! }))],
	[/^Updating (\S+): pulling image and recreating container$/, say("backend.stored.progress.qsUpdate", (m) => ({ slug: m[1]! }))],
	[/^Uninstalling (\S+): removing container and cleaning data directory$/, say("backend.stored.progress.qsUninstallClean", (m) => ({ slug: m[1]! }))],
	[/^Uninstalling (\S+): removing container and keeping data directory$/, say("backend.stored.progress.qsUninstallKeep", (m) => ({ slug: m[1]! }))],
];

/**
 * Dictionary sentences stored as rendered, in whichever language rendered them; recognised in both. Their
 * placeholders are said again too (the reason in "Skipped: …({reason})" is one of the literals above).
 */
const STORED_KEYS = [
	"backend.scheduled-task.skippedMissingTargetOrCreator",
	"backend.scheduled-task.skippedRequesterNotAuthorized",
	"backend.scheduled-task.dispatched",
	"backend.scheduled-task.manualRetryDispatched",
	"backend.scheduled-task.manualRetryMissingTargetOrCreator",
	"backend.backup.scheduleSkippedNoCreator",
	"backend.job.executorHeartbeatExpiredRequeued",
	"backend.job.executorHeartbeatExpiredAttemptsExhausted",
	"backend.job.parentDurableJobAttemptsExhausted",
	"backend.downloads.progress.directStarting",
	"backend.downloads.progress.relayStarting",
	"backend.downloads.progress.relayInProgress",
	"backend.downloads.progress.transferring",
	"backend.downloads.progress.completedAndTransferred",
	"backend.downloads.progress.downloading",
	// Why a backup record was voided: "已作废：{v0}" around one of the sweeps' reasons.
	"apiCopy.voided.991e85c4",
] as const;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A dictionary sentence as a pattern of its rendered text: each `{name}` captures what was put there. */
function renderedPattern(template: string): { pattern: RegExp; names: string[] } {
	const names: string[] = [];
	let source = "";
	let last = 0;
	for (const match of template.matchAll(/\{(\w+)\}/g)) {
		source += escapeRegExp(template.slice(last, match.index));
		const seen = names.indexOf(match[1]!);
		source += seen >= 0 ? `\\${seen + 1}` : "([\\s\\S]+?)";
		if (seen < 0) names.push(match[1]!);
		last = match.index! + match[0].length;
	}
	return { pattern: new RegExp(`^${source}${escapeRegExp(template.slice(last))}$`), names };
}

const RENDERED_FORMS: Array<{ key: string; pattern: RegExp; names: string[] }> = STORED_KEYS.flatMap((key) =>
	(["zh", "en"] as const)
		.map((locale) => serviceTranslations[locale][key])
		.filter((template): template is string => typeof template === "string" && template.length > 0)
		.map((template) => ({ key, ...renderedPattern(template) })),
);

// A sentence inside a sentence ("Execution failed: <reason>") is said again too, a couple of levels deep.
const MAX_DEPTH = 3;

function localizeAt(text: string, locale: Locale, depth: number): string {
	if (depth > MAX_DEPTH) return text;
	for (const [pattern, render] of ENGLISH_FORMS) {
		const match = text.match(pattern);
		if (match) return render(match, locale, depth);
	}
	for (const { key, pattern, names } of RENDERED_FORMS) {
		const match = text.match(pattern);
		if (!match) continue;
		const params = Object.fromEntries(names.map((name, index) => [name, localizeAt(match[index + 1]!, locale, depth + 1)]));
		return serviceT(key, locale, params);
	}
	return text;
}

/**
 * A stored sentence in the reader's language (inside a request, the request's; otherwise as given). Text that
 * is not one of the platform's own sentences is returned as it is.
 */
export function localizeStoredSentence(text: string, locale?: Locale): string {
	return localizeAt(text, locale ?? currentCopyLocale() ?? "zh", 0);
}

/** {@link localizeStoredSentence} for a column that may be empty. */
export function localizeStoredText(text: string | null | undefined, locale?: Locale): string | null {
	return text ? localizeStoredSentence(text, locale) : (text ?? null);
}
