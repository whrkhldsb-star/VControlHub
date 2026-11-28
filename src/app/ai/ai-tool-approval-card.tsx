"use client";

/**
 * One AI proposal waiting for the requester's decision, inline in the conversation that made it.
 *
 * It shows what will run and where (the command, the target server by name), the risk the server assigned
 * and why, and for `execute_command` lets the requester edit the command before confirming (or reset it).
 * A critical / denylisted command needs an explicit "I understand" before Confirm is enabled. The confirm
 * button says what happens: run now (live output follows here), or file a request for another reviewer.
 */
import { useEffect, useId, useRef, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { AlertTriangle, Pencil, RotateCcw } from "@/components/icons";
import { Badge, type BadgeTone } from "@/components/ui-primitives";
import { classifyCommandRisk, maxRiskLevel, type CommandRiskLevel } from "@/lib/command/risk-classifier";
import { formatDateTime } from "@/lib/datetime/format";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

import { type AiCapabilities, DEFAULT_AI_CAPABILITIES, isCommandActionType, predictInlineExecution } from "./ai-automation-mode";
import { approvalDetails, automationSummary, isCriticalApproval } from "./ai-hosted-action-utils";
import type { ToolApprovalNeeded } from "./ai-types";
import type { ApprovalDecisionOptions } from "./hooks/use-ai-chat-stream";

const CONFIRM_ONLY_ACTIONS = new Set(["manage_cron", "run_playbook", "create_automation_task"]);

export function riskTone(risk: string | null | undefined): BadgeTone {
	switch ((risk ?? "").toLowerCase()) {
		case "critical":
			return "danger";
		case "high":
			return "warning";
		case "medium":
			return "amber";
		default:
			return "success";
	}
}

/** Translates a label family member, falling back to the raw value for codes the dictionary does not know. */
export function useLabel() {
	const { t } = useI18n();
	return (key: string, fallback: string) => {
		const translated = t(key);
		return translated === key ? fallback : translated;
	};
}

export function AiToolApprovalCard({
	approval,
	busy,
	capabilities = DEFAULT_AI_CAPABILITIES,
	highlighted = false,
	onDecide,
}: {
	approval: ToolApprovalNeeded;
	busy: boolean;
	capabilities?: AiCapabilities;
	/** Deep-linked (`/ai?c=…&action=<id>`): scrolled into view and outlined. */
	highlighted?: boolean;
	onDecide: (approval: ToolApprovalNeeded, action: "confirm" | "reject", options?: ApprovalDecisionOptions) => void;
}) {
	const { t, locale } = useI18n();
	const label = useLabel();
	const cardRef = useRef<HTMLDivElement | null>(null);
	const ackId = useId();
	const editId = useId();
	const originalCommand = typeof approval.params.command === "string" ? approval.params.command : "";
	const editable = approval.actionType === "execute_command" && originalCommand !== "";
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(originalCommand);
	const [acknowledged, setAcknowledged] = useState(false);

	useEffect(() => {
		if (highlighted) cardRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
	}, [highlighted]);

	const edited = editable && draft.trim() !== originalCommand.trim();
	const emptyDraft = editable && editing && draft.trim() === "";
	const draftAssessment = edited && draft.trim() !== "" ? classifyCommandRisk(draft.trim()) : null;
	const baseRisk = (approval.effectiveRisk || approval.riskLevel || "medium") as CommandRiskLevel;
	const risk = draftAssessment
		? maxRiskLevel((approval.riskLevel || "low") as CommandRiskLevel, draftAssessment.level)
		: baseRisk;
	const effectiveDenylisted = draftAssessment ? draftAssessment.denylisted : Boolean(approval.denylisted);
	const critical = effectiveDenylisted || risk === "critical" || (!edited && isCriticalApproval(approval));
	const confirmOnly = CONFIRM_ONLY_ACTIONS.has(approval.actionType);
	const runsInline = isCommandActionType(approval.actionType)
		? edited
			? predictInlineExecution({ caps: capabilities, riskLevel: risk, denylisted: effectiveDenylisted })
			: approval.willExecuteInline ?? predictInlineExecution({ caps: capabilities, riskLevel: risk, denylisted: effectiveDenylisted })
		: false;
	const confirmLabel = confirmOnly
		? t("aiPage.confirmAction")
		: runsInline
			? t("aiPage.approvalCard.confirmRun")
			: t("aiPage.approve");
	const confirmDisabled = busy || emptyDraft || (critical && !acknowledged);
	const reasons = draftAssessment ? draftAssessment.reasons : (approval.riskReasons ?? []);
	const isAutomation = approval.actionType === "create_automation_task";

	const confirm = () => {
		const options: ApprovalDecisionOptions = {};
		if (edited) options.editedCommand = draft.trim();
		if (critical && acknowledged) options.acknowledgeCritical = true;
		onDecide(approval, "confirm", Object.keys(options).length > 0 ? options : undefined);
	};

	return (
		<div
			ref={cardRef}
			data-approval-card={approval.actionId}
			data-highlighted={highlighted ? "" : undefined}
			className={cn(
				"flex flex-col gap-2 rounded-lg bg-[var(--input-bg)] p-2.5",
				!isAutomation && "sm:flex-row sm:items-start sm:justify-between",
				highlighted && "ring-2 ring-[var(--accent)]",
			)}
		>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="text-sm font-medium text-[var(--text-primary)]">
						{label(`aiPage.actionType.${approval.actionType}`, approval.actionName)}
					</span>
					<Badge tone={riskTone(risk)} data-risk={risk}>
						{t("aiPage.approvalCard.riskBadge", { risk: label(`aiPage.risk.${risk}`, risk) })}
					</Badge>
					{effectiveDenylisted ? (
						<Badge tone="danger">
							<AlertTriangle size={11} aria-hidden />
							{t("aiPage.approvalCard.denylisted")}
						</Badge>
					) : null}
				</div>
				<div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
					{approval.server ? (
						t("aiPage.serverNamed", { name: approval.server.name, host: approval.server.host })
					) : typeof approval.params.serverId === "string" ? (
						t("aiPage.serverLabel", { id: approval.params.serverId })
					) : null}
				</div>
				{reasons.length > 0 ? (
					<div className="mt-1.5 text-xs">
						<p className="text-[var(--text-muted)]">{t("aiPage.approvalCard.reasonsTitle")}</p>
						<ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[var(--text-secondary)]">
							{reasons.map((reason) => (
								<li key={reason} data-risk-reason={reason}>{label(`commandsPage.riskReason.${reason}`, reason)}</li>
							))}
						</ul>
					</div>
				) : null}

				{!isAutomation ? (
					<dl className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
						{approvalDetails(approval.actionType, approval.params, t("common.listSeparator")).map((row) => {
							const isCommand = editable && row.labelKey === "aiPage.approvalCommand";
							return (
								<div key={row.labelKey}>
									<dt className="inline text-[var(--text-muted)]">{t(row.labelKey)}{t("common.colon")}</dt>
									{isCommand ? (
										<dd>
											{editing ? (
												<textarea
													id={editId}
													value={draft}
													maxLength={10000}
													onChange={(event) => {
														setDraft(event.target.value);
														setAcknowledged(false);
													}}
													aria-label={t("aiPage.approvalCard.editAria")}
													aria-invalid={emptyDraft || undefined}
													rows={Math.min(8, Math.max(2, draft.split("\n").length))}
													spellCheck={false}
													className={cn(UI_INPUT, "mt-1 w-full resize-y font-mono text-xs")}
												/>
											) : (
												<pre data-inset="" className="max-h-40 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-xs text-[var(--text-primary)]">{edited ? draft : row.value}</pre>
											)}
											<div className="mt-1 flex flex-wrap items-center gap-2">
												{!editing ? (
													<ActionButton size="xs" variant="ghost" icon={<Pencil size={12} aria-hidden />} disabled={busy} onClick={() => setEditing(true)}>
														{t("aiPage.approvalCard.edit")}
													</ActionButton>
												) : null}
												{edited || editing ? (
													<ActionButton
														size="xs"
														variant="ghost"
														icon={<RotateCcw size={12} aria-hidden />}
														disabled={busy || (!edited && !editing)}
														onClick={() => {
															setDraft(originalCommand);
															setAcknowledged(false);
															setEditing(false);
														}}
													>
														{t("aiPage.approvalCard.reset")}
													</ActionButton>
												) : null}
												{edited ? <Badge tone="accent">{t("aiPage.approvalCard.edited")}</Badge> : null}
											</div>
											{emptyDraft ? <p className="mt-1 text-[var(--danger)]">{t("aiPage.approvalCard.emptyCommand")}</p> : null}
											{edited ? <p className="mt-1 text-[var(--text-muted)]">{t("aiPage.approvalCard.editedNote")}</p> : null}
										</dd>
									) : row.block ? (
										<dd>
											<pre data-inset="" className="max-h-40 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-xs text-[var(--text-primary)]">{row.value}</pre>
										</dd>
									) : (
										<dd className="inline break-all text-[var(--text-primary)]">{row.value}</dd>
									)}
								</div>
							);
						})}
					</dl>
				) : (
					(() => {
						const summary = automationSummary(approval.params, t, (value) => formatDateTime(value, locale));
						return (
							<div className="mt-2 space-y-2 text-xs text-[var(--text-secondary)]">
								<dl className="space-y-1">
									<div><dt className="inline text-[var(--text-muted)]">{t("aiPage.automationExecution")}{t("common.colon")}</dt><dd className="inline text-[var(--text-primary)]">{summary.execution}</dd></div>
									<div><dt className="inline text-[var(--text-muted)]">{t("aiPage.automationTargets")}{t("common.colon")}</dt><dd className="inline break-words text-[var(--text-primary)]">{summary.targets}</dd></div>
									<div><dt className="inline text-[var(--text-muted)]">{t("aiPage.automationApproval")}{t("common.colon")}</dt><dd className="inline text-[var(--text-primary)]">{summary.approval}</dd></div>
									{typeof approval.params.templateName === "string" && <div><dt className="inline text-[var(--text-muted)]">{t("aiPage.automationTemplate")}{t("common.colon")}</dt><dd className="inline text-[var(--text-primary)]">{approval.params.templateName}</dd></div>}
								</dl>
								{typeof approval.params.plan === "string" && <p className="whitespace-pre-wrap break-words leading-5">{approval.params.plan}</p>}
								{typeof approval.params.command === "string" && <pre data-inset="" className="max-h-40 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-xs text-[var(--text-primary)]">{approval.params.command}</pre>}
								{(typeof approval.params.verificationCommand === "string" || typeof approval.params.rollbackCommand === "string") && <div className="space-y-1 font-mono text-xs">{typeof approval.params.verificationCommand === "string" && <p>{t("aiPage.automationVerify")}{t("common.colon")}{approval.params.verificationCommand}</p>}{typeof approval.params.rollbackCommand === "string" && <p>{t("aiPage.automationRollback")}{t("common.colon")}{approval.params.rollbackCommand}</p>}</div>}
							</div>
						);
					})()
				)}

				{critical ? (
					<label htmlFor={ackId} className="mt-2 flex cursor-pointer items-start gap-2 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] p-2 text-xs text-[var(--danger)]">
						<input
							id={ackId}
							type="checkbox"
							checked={acknowledged}
							disabled={busy}
							onChange={(event) => setAcknowledged(event.target.checked)}
							className="mt-0.5 shrink-0"
						/>
						<span>{t("aiPage.approvalCard.ackCritical")}</span>
					</label>
				) : null}
				{isCommandActionType(approval.actionType) ? (
					<p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
						{t(runsInline ? "aiPage.approvalCard.inlineHint" : "aiPage.approvalCard.reviewHint")}
					</p>
				) : null}
			</div>
			<div className="flex w-full gap-2 sm:ml-3 sm:w-auto sm:shrink-0">
				<ActionButton
					size="sm"
					variant="danger-solid"
					className="flex-1 sm:flex-none"
					disabled={busy}
					aria-busy={busy ? "true" : undefined}
					onClick={() => onDecide(approval, "reject")}
				>
					{t("aiPage.reject")}
				</ActionButton>
				<ActionButton
					size="sm"
					variant="success-solid"
					className="flex-1 sm:flex-none"
					disabled={confirmDisabled}
					aria-busy={busy ? "true" : undefined}
					aria-describedby={critical && !acknowledged ? ackId : undefined}
					onClick={confirm}
				>
					{confirmLabel}
				</ActionButton>
			</div>
		</div>
	);
}
