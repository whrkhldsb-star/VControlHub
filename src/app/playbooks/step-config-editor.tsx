"use client";

import { useId } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { fieldInputClass, monoFieldInputClass } from "./playbook-types";
import type { SerializedStep, ServerOption } from "./playbook-types";

export function StepConfigEditor({
	step,
	servers,
	onConfigChange,
}: {
	step: SerializedStep;
	servers: ServerOption[];
	onConfigChange: (patch: Record<string, unknown>) => void;
}) {
	const { t } = useI18n();
	const fieldId = useId();
	const cfg = step.config;
	if (step.type === "run_command") {
		const selected = Array.isArray(cfg.serverIds)
			? (cfg.serverIds as string[]).filter((id) => typeof id === "string" && id.length > 0)
			: [];
		const enabledServers = servers.filter((s) => s.enabled);
		const toggleServer = (id: string) => {
			const next = new Set(selected);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			onConfigChange({ serverIds: [...next] });
		};
		const selectAllEnabled = () => {
			if (enabledServers.length === 0) return;
			if (selected.length === enabledServers.length) {
				onConfigChange({ serverIds: [] });
			} else {
				onConfigChange({ serverIds: enabledServers.map((s) => s.id) });
			}
		};
		return (
			<div className="space-y-2">
				<div className="space-y-1.5">
					<label htmlFor={`${fieldId}-command`} className="text-[11px] text-[var(--text-secondary)]">
						{t("playbooksPage.step.commandLabel")}
					</label>
					<textarea
						id={`${fieldId}-command`}
						value={String(cfg.command ?? "")}
						onChange={(e) => onConfigChange({ command: e.target.value })}
						rows={2}
						placeholder="docker compose up -d"
						className={`${monoFieldInputClass} resize-y`}
						required
					/>
				</div>
				<div className="space-y-1.5">
					<div className="flex items-center justify-between gap-2">
						<span id={`${fieldId}-servers-label`} className="text-[11px] text-[var(--text-secondary)]">
							{t("playbooksPage.step.serversLabel")}
						</span>
						{enabledServers.length > 0 && (
							<button
								type="button"
								onClick={selectAllEnabled}
								className="text-[11px] text-[var(--color-action)] hover:underline"
							>
								{selected.length === enabledServers.length
									? t("playbooksPage.step.deselectAllServers")
									: t("playbooksPage.step.selectAllEnabledServers")}
							</button>
						)}
					</div>
					{servers.length === 0 ? (
						<p role="alert" className="text-[11px] text-[var(--danger)]">
							{t("playbooksPage.step.noServers")}
						</p>
					) : (
						<div
							role="group"
							aria-labelledby={`${fieldId}-servers-label`}
							className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
						>
							{servers.map((server) => {
								const checked = selected.includes(server.id);
								return (
									<label
										key={server.id}
										className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs transition hover:bg-[var(--surface-hover)] ${
											!server.enabled ? "opacity-50" : ""
										}`}
									>
										<input
											type="checkbox"
											checked={checked}
											disabled={!server.enabled && !checked}
											onChange={() => toggleServer(server.id)}
											className="accent-[var(--color-action)]"
										/>
										<span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
											{server.name}
											<span className="ml-1 text-[var(--text-muted)]">({server.host})</span>
										</span>
										{!server.enabled && (
											<span className="shrink-0 text-[10px] text-[var(--text-muted)]">
												{t("playbooksPage.step.serverDisabled")}
											</span>
										)}
									</label>
								);
							})}
						</div>
					)}
					{selected.length === 0 && servers.length > 0 && (
						<p className="text-[11px] text-[var(--warn)]">{t("playbooksPage.step.serversRequired")}</p>
					)}
					<p className="text-[10px] text-[var(--text-muted)]">{t("playbooksPage.createForm.runCommandHint")}</p>
				</div>
			</div>
		);
	}
	if (step.type === "send_notification") {
		return (
			<div className="space-y-1.5">
				<label htmlFor={`${fieldId}-recipient`} className="text-[11px] text-[var(--text-secondary)]">
					recipientUserId
				</label>
				<input
					id={`${fieldId}-recipient`}
					value={String(cfg.recipientUserId ?? "")}
					aria-label={t("playbooksPage.step.recipientAria")}
					onChange={(e) => onConfigChange({ recipientUserId: e.target.value })}
					className={fieldInputClass}
				/>
				<label htmlFor={`${fieldId}-subject`} className="text-[11px] text-[var(--text-secondary)]">
					subject
				</label>
				<input
					id={`${fieldId}-subject`}
					value={String(cfg.subject ?? "")}
					aria-label={t("playbooksPage.step.subjectAria")}
					onChange={(e) => onConfigChange({ subject: e.target.value })}
					className={fieldInputClass}
				/>
				<label htmlFor={`${fieldId}-body`} className="text-[11px] text-[var(--text-secondary)]">
					body
				</label>
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
			<label htmlFor={`${fieldId}-url`} className="text-[11px] text-[var(--text-secondary)]">
				url
			</label>
			<input
				id={`${fieldId}-url`}
				value={String(cfg.url ?? "")}
				aria-label={t("playbooksPage.step.urlAria")}
				onChange={(e) => onConfigChange({ url: e.target.value })}
				placeholder="https://example.com/hook"
				className={fieldInputClass}
			/>
			<label htmlFor={`${fieldId}-method`} className="text-[11px] text-[var(--text-secondary)]">
				method
			</label>
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
			<label htmlFor={`${fieldId}-webhook-body`} className="text-[11px] text-[var(--text-secondary)]">
				body (JSON, optional)
			</label>
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
