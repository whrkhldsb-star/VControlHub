import { arrayMove } from "@dnd-kit/sortable";
import { formatDateTime } from "@/lib/datetime/format";
import { UI_INPUT, UI_LABEL } from "@/lib/ui/classes";

export type TriggerType = "cron" | "metric";
export type StepType = "run_command" | "send_notification" | "call_webhook";

export type ServerOption = {
	id: string;
	name: string;
	host: string;
	enabled: boolean;
};

export type SerializedStep = {
	id: string;
	name: string;
	type: StepType;
	config: Record<string, unknown>;
	retry: number;
	timeoutSec: number;
};

export type SerializedPlaybook = {
	id: string;
	name: string;
	description: string | null;
	triggerType: TriggerType;
	triggerConfig: Record<string, unknown>;
	steps: SerializedStep[];
	chainRetry: number;
	enabled: boolean;
	nextRunAt: string | null;
	lastTriggeredAt: string | null;
	/** False when the creator was deleted/disabled: scheduled runs fail until someone claims it. */
	ownerActive: boolean;
	createdAt: string;
};

export type RunStepSummary = {
	stepId: string;
	status: "running" | "ok" | "failed" | "skipped" | "dry_run" | string;
	summary?: string;
	error?: string;
	commandRequestId?: string;
};

export type RunSummary = {
	id: string;
	status: string;
	dryRun: boolean;
	startedAt: string | null;
	completedAt: string | null;
	errorMessage: string | null;
	stepResults?: RunStepSummary[];
};

export function dryRunStepCounts(run: Pick<RunSummary, "stepResults">): { ok: number; total: number } {
	const steps = run.stepResults ?? [];
	return {
		ok: steps.filter((step) => step.status === "dry_run" || step.status === "ok").length,
		total: steps.length,
	};
}

export const fieldLabelClass = UI_LABEL;
export const fieldInputClass = UI_INPUT;
export const monoFieldInputClass = `${UI_INPUT} font-mono`;

export function stepTypeLabel(t: (k: string, vars?: Record<string, string | number>) => string, type: StepType): string {
	return t(`playbooksPage.stepType.${type}`);
}

export function statusLabelFor(t: (k: string, vars?: Record<string, string | number>) => string, status: string): string {
	switch (status) {
		case "completed":
			return t("playbooksPage.status.completed");
		case "failed":
			return t("playbooksPage.status.failed");
		case "running":
			return t("playbooksPage.status.running");
		case "queued":
			return t("playbooksPage.status.queued");
		case "cancelled":
			return t("playbooksPage.status.cancelled");
		default:
			return status;
	}
}

export function formatTime(iso: string | null, locale: string = "zh"): string {
	if (!iso) return "—";
	return formatDateTime(iso, locale as "zh" | "en");
}

export function defaultConfigFor(type: StepType): Record<string, unknown> {
	if (type === "run_command") return { command: "", serverIds: [] as string[] };
	if (type === "send_notification") return { recipientUserId: "", subject: "", body: "" };
	return { url: "https://", method: "POST" as const };
}

export function makeNewStep(): SerializedStep {
	const id = `step-${Math.random().toString(36).slice(2, 9)}`;
	return {
		id,
		name: "",
		type: "run_command",
		config: defaultConfigFor("run_command"),
		retry: 0,
		timeoutSec: 60,
	};
}

/** A playbook's fields as its form sends them. */
export type PlaybookFields = {
	name: string;
	description: string | null;
	triggerType: TriggerType;
	triggerConfig: Record<string, unknown>;
	steps: SerializedStep[];
	chainRetry: number;
	enabled: boolean;
};

/** A step as the API takes it (the form's copy carries nothing else, but a saved one may). */
export function stepPayload(step: SerializedStep): SerializedStep {
	return { id: step.id, name: step.name, type: step.type, config: step.config, retry: step.retry, timeoutSec: step.timeoutSec };
}

/** A trigger's settings in the shape the form sends, so a saved playbook's compare with the form's. */
function triggerConfigOf(triggerType: TriggerType, config: Record<string, unknown>): Record<string, unknown> {
	return triggerType === "cron"
		? { expression: String(config.expression ?? "") }
		: { metric: config.metric, operator: config.operator, threshold: Number(config.threshold) };
}

/**
 * The fields of an edited playbook that differ from the saved one: what the edit sends. Sending every field asked
 * for more than the change did: the trigger, the switch and the retries take playbook:run to change, so a member
 * who may only manage playbooks could not fix a step's name, and a re-sent trigger dropped a metric trigger's state.
 */
export function changedPlaybookFields(saved: SerializedPlaybook, next: PlaybookFields): Partial<PlaybookFields> {
	const changes: Partial<PlaybookFields> = {};
	if (next.name !== saved.name) changes.name = next.name;
	if ((next.description || null) !== (saved.description || null)) changes.description = next.description || null;
	if (
		next.triggerType !== saved.triggerType
		|| JSON.stringify(triggerConfigOf(next.triggerType, next.triggerConfig)) !== JSON.stringify(triggerConfigOf(saved.triggerType, saved.triggerConfig))
	) {
		changes.triggerType = next.triggerType;
		changes.triggerConfig = next.triggerConfig;
	}
	const steps = next.steps.map(stepPayload);
	if (JSON.stringify(steps) !== JSON.stringify(saved.steps.map(stepPayload))) changes.steps = steps;
	if (next.chainRetry !== saved.chainRetry) changes.chainRetry = next.chainRetry;
	if (next.enabled !== saved.enabled) changes.enabled = next.enabled;
	return changes;
}

export function reorderSteps(steps: SerializedStep[], activeId: string, overId: string) {
	const oldIndex = steps.findIndex((step) => step.id === activeId);
	const newIndex = steps.findIndex((step) => step.id === overId);
	if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return steps;
	return arrayMove(steps, oldIndex, newIndex);
}
