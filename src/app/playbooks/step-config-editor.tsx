"use client";

import { useId } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { fieldInputClass, monoFieldInputClass } from "./playbook-types";
import type { SerializedStep } from "./playbook-types";

export function StepConfigEditor({
	step,
	onConfigChange,
}: {
	step: SerializedStep;
	onConfigChange: (patch: Record<string, unknown>) => void;
}) {
	const { t } = useI18n();
	const fieldId = useId();
	const cfg = step.config;
	if (step.type === "run_command") {
		return (
			<div className="space-y-1.5">
				<label htmlFor={`${fieldId}-command`} className="text-[11px] text-[var(--text-secondary)]">command</label>
				<textarea
					id={`${fieldId}-command`}
					value={String(cfg.command ?? "")}
					onChange={(e) => onConfigChange({ command: e.target.value })}
					rows={2}
					placeholder="docker compose up -d"
					className={`${monoFieldInputClass} resize-y`}
				/>
				<p className="text-[10px] text-[var(--text-muted)]">{t("playbooksPage.createForm.runCommandHint")}</p>
			</div>
		);
	}
	if (step.type === "send_notification") {
		return (
			<div className="space-y-1.5">
				<label htmlFor={`${fieldId}-recipient`} className="text-[11px] text-[var(--text-secondary)]">recipientUserId</label>
				<input
					id={`${fieldId}-recipient`}
					value={String(cfg.recipientUserId ?? "")}
					aria-label={t("playbooksPage.step.recipientAria")}
					onChange={(e) => onConfigChange({ recipientUserId: e.target.value })}
					className={fieldInputClass}
				/>
				<label htmlFor={`${fieldId}-subject`} className="text-[11px] text-[var(--text-secondary)]">subject</label>
				<input
					id={`${fieldId}-subject`}
					value={String(cfg.subject ?? "")}
					aria-label={t("playbooksPage.step.subjectAria")}
					onChange={(e) => onConfigChange({ subject: e.target.value })}
					className={fieldInputClass}
				/>
				<label htmlFor={`${fieldId}-body`} className="text-[11px] text-[var(--text-secondary)]">body</label>
				<textarea
					id={`${fieldId}-body`}
					value={String(cfg.body ?? "")}
					onChange={(e) => onConfigChange({ body: e.target.value })}
					rows={2}
					className={`${fieldInputClass} resize-y`}
				/>
			</div>
		);
	}
	return (
		<div className="space-y-1.5">
			<label htmlFor={`${fieldId}-url`} className="text-[11px] text-[var(--text-secondary)]">url</label>
			<input
				id={`${fieldId}-url`}
				value={String(cfg.url ?? "")}
				aria-label={t("playbooksPage.step.urlAria")}
			onChange={(e) => onConfigChange({ url: e.target.value })}
				placeholder="https://example.com/hook"
				className={fieldInputClass}
			/>
			<label htmlFor={`${fieldId}-method`} className="text-[11px] text-[var(--text-secondary)]">method</label>
			<select
				id={`${fieldId}-method`}
				value={String(cfg.method ?? "POST")}
				onChange={(e) => onConfigChange({ method: e.target.value })}
				className={fieldInputClass}
			>
				{(["GET", "POST", "PUT"] as const).map((m) => (
					<option key={m} value={m}>
						{m}
					</option>
				))}
			</select>
			<label htmlFor={`${fieldId}-webhook-body`} className="text-[11px] text-[var(--text-secondary)]">body (JSON, optional)</label>
			<textarea
				id={`${fieldId}-webhook-body`}
				value={String(cfg.body ?? "")}
				onChange={(e) => onConfigChange({ body: e.target.value })}
				rows={2}
				className={`${monoFieldInputClass} resize-y`}
			/>
		</div>
	);
}
