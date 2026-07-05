"use client";

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
	const cfg = step.config;
	if (step.type === "run_command") {
		return (
			<div className="space-y-1.5">
				<label className="text-[11px] text-[var(--text-secondary)]">command</label>
				<textarea
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
				<label className="text-[11px] text-[var(--text-secondary)]">recipientUserId</label>
				<input
					value={String(cfg.recipientUserId ?? "")}
					aria-label="recipientUserId"
					onChange={(e) => onConfigChange({ recipientUserId: e.target.value })}
					className={fieldInputClass}
				/>
				<label className="text-[11px] text-[var(--text-secondary)]">subject</label>
				<input
					value={String(cfg.subject ?? "")}
					aria-label="subject"
					onChange={(e) => onConfigChange({ subject: e.target.value })}
					className={fieldInputClass}
				/>
				<label className="text-[11px] text-[var(--text-secondary)]">body</label>
				<textarea
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
			<label className="text-[11px] text-[var(--text-secondary)]">url</label>
			<input
				value={String(cfg.url ?? "")}
				aria-label="url"
			onChange={(e) => onConfigChange({ url: e.target.value })}
				placeholder="https://example.com/hook"
				className={fieldInputClass}
			/>
			<label className="text-[11px] text-[var(--text-secondary)]">method</label>
			<select
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
			<label className="text-[11px] text-[var(--text-secondary)]">body (JSON, optional)</label>
			<textarea
				value={String(cfg.body ?? "")}
				onChange={(e) => onConfigChange({ body: e.target.value })}
				rows={2}
				className={`${monoFieldInputClass} resize-y`}
			/>
		</div>
	);
}
