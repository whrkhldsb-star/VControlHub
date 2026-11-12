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
	/** Resolves to whether the deployment was accepted. */
	onDeploy: (t: Template, s: string[], v: Record<string, string>) => Promise<boolean>;
	loading: boolean;
}) {
	const { t } = useI18n();
	const deployFormId = useId();
	const [open, setOpen] = useState(false);
	const [vars, setVars] = useState<Record<string, string>>({});
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	if (!open) {
		return (
			<ActionButton size="sm" type="button" variant="outline" onClick={() => setOpen(true)}>
				{t("templatesPage.action.deploy")}
			</ActionButton>
		);
	}

	const enabledServers = servers.filter((s) => s.enabled);

	return (
		<div className="w-full space-y-2.5">
			{template.variables.map((v) => {
				const variableInputId = `${deployFormId}-${v}`;
				const variableLabel = t("templatesPage.variable", { name: v });
				return (
					<div key={v} className="flex items-center gap-2">
						<label
							htmlFor={variableInputId}
							className="ui-label w-24 shrink-0 font-mono text-[var(--warning)]"
						>
							{variableLabel}
						</label>
						<input
							id={variableInputId}
							value={vars[v] ?? ""}
							onChange={(e) => setVars((prev) => ({ ...prev, [v]: e.target.value }))}
							placeholder={`{{${v}}}`}
							className={cn(UI_INPUT, "flex-1 py-1 font-mono text-xs")}
						/>
					</div>
				);
			})}
			{enabledServers.length === 0 ? (
				// A disabled button over an empty row of targets said nothing.
				<p className="text-xs text-[var(--text-muted)]">{t("templatesPage.deploy.noServers")}</p>
			) : null}
			<div className="flex flex-wrap gap-1">
				{enabledServers.map((s) => (
					<label
						key={s.id}
						data-tile=""
						data-selected={selectedIds.has(s.id) ? "" : undefined}
						className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs text-[var(--text-secondary)] transition"
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
				<ActionButton size="sm"
					type="button"
					// Sent: the panel folds away, so that a second press does not send it again.
					onClick={() => { void onDeploy(template, [...selectedIds], vars).then((accepted) => { if (accepted) setOpen(false); }); }}
					disabled={loading || selectedIds.size === 0}>
					{loading ? t("templatesPage.action.submitting") : t("templatesPage.action.submit")}
				</ActionButton>
				<ActionButton size="sm"
					type="button"
					variant="secondary"
					onClick={() => setOpen(false)}>
					{t("templatesPage.action.cancel")}
				</ActionButton>
			</div>
		</div>
	);
}
