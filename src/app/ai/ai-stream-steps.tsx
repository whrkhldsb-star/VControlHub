"use client";

/**
 * The answer's tool calls while it streams, one row per call, updated as the stream reports them: called
 * (running, or waiting for approval), run automatically by Auto / Full auto (`tool_execution`), answered
 * (`tool_result`: how many results, the exit code, what went wrong, the output on demand). An automatically
 * run command that the page follows shows its live output under its row.
 */
import { Check, Clock, Loader2, X } from "@/components/icons";
import { Badge } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";

import { AiLiveActionPanel } from "./ai-live-action-panel";
import { riskTone, useLabel } from "./ai-tool-approval-card";
import type { StreamStep } from "./ai-types";
import type { TrackedAction } from "./hooks/use-hosted-action-tracker";

/** The state of one tool call while the answer streams. */
function StreamStepIcon({ state }: { state: StreamStep["state"] }) {
	if (state === "running") return <Loader2 size={12} aria-hidden className="mt-0.5 shrink-0 animate-spin" />;
	if (state === "awaiting") return <Clock size={12} aria-hidden className="mt-0.5 shrink-0 text-[var(--warning)]" />;
	if (state === "succeeded") return <Check size={12} aria-hidden className="mt-0.5 shrink-0 text-[var(--success)]" />;
	return <X size={12} aria-hidden className="mt-0.5 shrink-0 text-[var(--danger)]" />;
}

export function AiStreamSteps({
	steps,
	separated,
	trackedActions = {},
	canCancel = false,
	onCancelAction,
}: {
	steps: StreamStep[];
	/** Text came before the list: draw a rule between them. */
	separated: boolean;
	trackedActions?: Record<string, TrackedAction>;
	canCancel?: boolean;
	onCancelAction?: (actionId: string) => void;
}) {
	const { t } = useI18n();
	const label = useLabel();
	const riskName = (risk: string) => label(`aiPage.risk.${risk}`, risk);
	/** A tool call's line while the answer streams, with the action named as the approval cards name it. */
	const stepText = (step: StreamStep) => {
		const name = step.actionType ? label(`aiPage.actionType.${step.actionType}`, step.name ?? step.actionType) : step.name;
		if (!name) return t("aiPage.step.failedUnnamed");
		if (step.state === "awaiting") return t("aiPage.step.awaiting", { name, risk: riskName(step.riskLevel ?? "") });
		if (step.auto && step.phase === "timeout") return t("aiPage.step.timeout", { name });
		if (step.auto && step.state === "running") return t("aiPage.step.auto", { name });
		return t(`aiPage.step.${step.state}`, { name });
	};

	return (
		<ul
			aria-label={t("aiPage.step.listAria")}
			className={`space-y-1 text-xs text-[var(--text-muted)] ${separated ? "mt-2 border-t border-[var(--border-subtle)] pt-2" : ""}`}
		>
			{steps.map((step) => {
				const tracked = step.auto && step.actionId ? trackedActions[step.actionId] : undefined;
				const details = [
					typeof step.exitCode === "number" ? t("aiPage.live.exitCode", { code: step.exitCode }) : null,
					typeof step.resultCount === "number" ? t("aiPage.step.resultCount", { count: step.resultCount }) : null,
				].filter((value): value is string => Boolean(value));
				return (
					<li key={step.toolCallId} data-stream-step={step.state} data-step-phase={step.phase}>
						<div className="flex items-start gap-1.5">
							<StreamStepIcon state={step.state} />
							<span className="min-w-0">{stepText(step)}</span>
							{step.auto ? (
								<span className="ml-1 inline-flex shrink-0 flex-wrap items-center gap-1">
									<Badge tone="accent">{t("aiPage.step.autoBadge")}</Badge>
									{step.riskLevel ? <Badge tone={riskTone(step.riskLevel)}>{t("aiPage.approvalCard.riskBadge", { risk: riskName(step.riskLevel) })}</Badge> : null}
								</span>
							) : null}
						</div>
						{details.length > 0 || step.error ? (
							<p className="ml-[18px] mt-0.5 break-words">
								{details.join(t("common.listSeparator"))}
								{step.error ? <span className="ml-1 text-[var(--danger)]">{step.error}</span> : null}
							</p>
						) : null}
						{step.output && !tracked ? (
							<details className="ml-[18px] mt-0.5">
								<summary className="cursor-pointer hover:text-[var(--text-primary)]">{t("aiPage.step.output")}</summary>
								<pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border-l border-[var(--border)] pl-2 font-mono text-[11px] text-[var(--text-secondary)]">{step.output}</pre>
							</details>
						) : null}
						{tracked ? (
							<div className="ml-[18px]">
								<AiLiveActionPanel action={tracked} canCancel={canCancel} onCancel={(id) => onCancelAction?.(id)} compact />
							</div>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
