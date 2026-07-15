"use client";

import { useId, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

import type { ServerOption, Template } from "./template-types";

export function DeployButton({
	template,
	servers,
	onDeploy,
	loading,
}: {
	template: Template;
	servers: ServerOption[];
	onDeploy: (t: Template, s: string[], v: Record<string, string>) => void;
	loading: boolean;
}) {
	const { t } = useI18n();
	const deployFormId = useId();
	const [open, setOpen] = useState(false);
	const [vars, setVars] = useState<Record<string, string>>({});
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	if (!open) {
		return (
			<ActionButton type="button" onClick={() => setOpen(true)} className="min-h-11 px-3 text-[11px]">
				{t("templatesPage.action.deploy")}
			</ActionButton>
		);
	}

	const enabledServers = servers.filter((s) => s.enabled);

	return (
		<div className="w-full space-y-2.5">
			{template.variables.map((v) => {
				const variableInputId = `${deployFormId}-${v}`;
				const variableLabel = t("templatesPage.variable").replace("{name}", v);
				return (
					<div key={v} className="flex items-center gap-2">
						<label
							htmlFor={variableInputId}
							className="w-24 shrink-0 font-mono text-[11px] text-[var(--warning)]"
						>
							{variableLabel}
						</label>
						<input
							id={variableInputId}
							value={vars[v] ?? ""}
							onChange={(e) => setVars((prev) => ({ ...prev, [v]: e.target.value }))}
							placeholder={`{{${v}}}`}
							className={cn(UI_INPUT, "flex-1 py-1 font-mono text-[11px]")}
						/>
					</div>
				);
			})}
			<div className="flex flex-wrap gap-1">
				{enabledServers.map((s) => (
					<label
						key={s.id}
						className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition ${
							selectedIds.has(s.id)
								? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--text-primary)]"
								: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]"
						}`}
					>
						<input
							type="checkbox"
							checked={selectedIds.has(s.id)}
							onChange={() => {
								setSelectedIds((prev) => {
									const n = new Set(prev);
									if (n.has(s.id)) n.delete(s.id);
									else n.add(s.id);
									return n;
								});
							}}
							className="accent-[var(--color-action)]"
						/>
						{s.name}
					</label>
				))}
			</div>
			<div className="flex gap-2">
				<ActionButton
					type="button"
					onClick={() => onDeploy(template, [...selectedIds], vars)}
					disabled={loading || selectedIds.size === 0}
					className="min-h-11 px-3 text-[11px]"
				>
					{loading ? t("templatesPage.action.submitting") : t("templatesPage.action.submit")}
				</ActionButton>
				<ActionButton
					type="button"
					variant="secondary"
					onClick={() => setOpen(false)}
					className="min-h-11 px-3 text-[11px]"
				>
					{t("templatesPage.action.cancel")}
				</ActionButton>
			</div>
		</div>
	);
}
