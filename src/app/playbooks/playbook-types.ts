import { arrayMove } from "@dnd-kit/sortable";
import { formatDateTime } from "@/lib/datetime/format";

export type TriggerType = "cron" | "metric";
export type StepType = "run_command" | "send_notification" | "call_webhook";

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

export const fieldLabelClass = "text-xs font-medium text-[var(--text-secondary)] tracking-wide";
export const fieldInputClass = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/30";
export const monoFieldInputClass = `${fieldInputClass} font-mono`;

export function stepTypeLabel(t: (k: string) => string, type: StepType): string {
	return t(`playbooksPage.stepType.${type}`);
}

export function statusLabelFor(t: (k: string) => string, status: string): string {
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

export function reorderSteps(steps: SerializedStep[], activeId: string, overId: string) {
	const oldIndex = steps.findIndex((step) => step.id === activeId);
	const newIndex = steps.findIndex((step) => step.id === overId);
	if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return steps;
	return arrayMove(steps, oldIndex, newIndex);
}
