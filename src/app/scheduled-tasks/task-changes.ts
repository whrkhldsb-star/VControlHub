/** A scheduled task's fields as its form sends them. */
export type TaskFormValues = {
	name: string;
	scheduleType: "CRON" | "ONCE";
	cronExpression: string;
	/** A one-off task's time, as an ISO string. */
	runAt?: string;
	command: string;
	reason: string;
	plan: string;
	verificationCommand: string;
	rollbackCommand: string;
	approvalRequired: boolean;
	/** The template picked in this form, if one was. */
	templateId?: string;
	serverIds: string[];
};

/** A task as the list holds it. */
export type SavedTask = {
	name: string;
	scheduleType?: "CRON" | "ONCE";
	cronExpression: string;
	runAt?: string | null;
	command: string;
	reason: string | null;
	plan?: string | null;
	verificationCommand?: string | null;
	rollbackCommand?: string | null;
	approvalRequired?: boolean;
	serverIds: string[];
};

/** The minute a time falls in: the form keeps a one-off time to the minute. */
const minuteOf = (iso: string | null | undefined) => (iso ? Math.floor(new Date(iso).getTime() / 60_000) : null);

/**
 * The fields of an edited task that differ from the saved one: what the edit sends. Sending every field refused
 * edits that changed nothing risky: a re-sent schedule is computed again and a one-off time already past is
 * refused (renaming a one-off task that had run failed), and a re-sent "no approval" takes command:approve even
 * when approval was already off.
 */
export function changedTaskFields(saved: SavedTask, next: TaskFormValues): Partial<TaskFormValues> {
	const changes: Partial<TaskFormValues> = {};
	if (next.name !== saved.name) changes.name = next.name;
	const scheduleType = saved.scheduleType ?? "CRON";
	const scheduleChanged = next.scheduleType !== scheduleType
		|| (next.scheduleType === "CRON" ? next.cronExpression.trim() !== saved.cronExpression : minuteOf(next.runAt) !== minuteOf(saved.runAt));
	if (scheduleChanged) {
		changes.scheduleType = next.scheduleType;
		if (next.scheduleType === "CRON") changes.cronExpression = next.cronExpression;
		else changes.runAt = next.runAt;
	}
	if (next.command !== saved.command) changes.command = next.command;
	// An emptied field is sent as "", which clears it.
	if (next.reason !== (saved.reason ?? "")) changes.reason = next.reason;
	if (next.plan !== (saved.plan ?? "")) changes.plan = next.plan;
	if (next.verificationCommand !== (saved.verificationCommand ?? "")) changes.verificationCommand = next.verificationCommand;
	if (next.rollbackCommand !== (saved.rollbackCommand ?? "")) changes.rollbackCommand = next.rollbackCommand;
	if (next.approvalRequired !== (saved.approvalRequired ?? true)) changes.approvalRequired = next.approvalRequired;
	if (next.templateId) changes.templateId = next.templateId;
	const sameServers = (a: string[], b: string[]) => [...a].sort().join("\n") === [...b].sort().join("\n");
	if (!sameServers(next.serverIds, saved.serverIds)) changes.serverIds = next.serverIds;
	return changes;
}
