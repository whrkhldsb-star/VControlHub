/**
 * The checks at the top of the dashboard: what is waiting for this account right now. Pure, so the rules are
 * tested without React or the database; the dashboard gathers the inputs, each behind the permission of the
 * page that deals with it.
 */

export type AttentionKind = "alerts" | "failedTasks" | "approvals";

export type AttentionCheck = {
	kind: AttentionKind;
	/** How many are waiting; 0 when the check found nothing. */
	count: number;
	/** The most recent of them, as its own page names it; null when there is none. */
	latest: string | null;
	/** The page where they are dealt with. */
	href: string;
	/** "danger" for something broken now (an alert firing, a task that failed), "warning" for something waiting on a person. */
	tone: "danger" | "warning";
};

/** A failed task stops being news after a day: the task centre keeps it, the dashboard stops asking for it. */
export const FAILED_TASK_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AttentionInput = {
	/** Open (not yet acknowledged) alert incidents, newest first; null when the account does not manage alerts. */
	openIncidents: ReadonlyArray<{ title: string }> | null;
	/** Failed tasks of any age; null when the account cannot read the task centre. */
	failedTasks: ReadonlyArray<{ title: string; updatedAt: string | Date }> | null;
	/** Commands waiting for approval, newest first; null when the account cannot approve. */
	pendingApprovals: ReadonlyArray<{ title: string }> | null;
	now: Date;
};

/**
 * One check per kind the account can see, in a fixed order, found or not: the block shows the same rows every
 * time, and an empty block means the account can see none of them.
 */
export function buildAttentionChecks(input: AttentionInput): AttentionCheck[] {
	const checks: AttentionCheck[] = [];
	if (input.openIncidents) {
		checks.push({
			kind: "alerts",
			count: input.openIncidents.length,
			latest: input.openIncidents[0]?.title ?? null,
			href: "/alert-rules#incidents",
			tone: "danger",
		});
	}
	if (input.failedTasks) {
		const since = input.now.getTime() - FAILED_TASK_WINDOW_MS;
		const recent = input.failedTasks
			.map((task) => ({ title: task.title, at: new Date(task.updatedAt).getTime() }))
			.filter((task) => task.at >= since)
			.sort((a, b) => b.at - a.at);
		checks.push({
			kind: "failedTasks",
			count: recent.length,
			latest: recent[0]?.title ?? null,
			href: "/operation-tasks?status=failed",
			tone: "danger",
		});
	}
	if (input.pendingApprovals) {
		checks.push({
			kind: "approvals",
			count: input.pendingApprovals.length,
			latest: input.pendingApprovals[0]?.title ?? null,
			href: "/requests",
			tone: "warning",
		});
	}
	return checks;
}

/** How many of the checks found something. */
export function countAttention(checks: ReadonlyArray<AttentionCheck>): number {
	return checks.filter((check) => check.count > 0).length;
}

/** The tone of the block: the worst one found, or null when nothing was. */
export function attentionTone(checks: ReadonlyArray<AttentionCheck>): AttentionCheck["tone"] | null {
	const found = checks.filter((check) => check.count > 0);
	if (found.some((check) => check.tone === "danger")) return "danger";
	return found.length > 0 ? "warning" : null;
}
