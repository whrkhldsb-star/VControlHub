"use client";

import { useId, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { FormField } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

export function CreateTemplateForm({ onClose }: { onClose: () => void }) {
	const { t } = useI18n();
	const createFormId = useId();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [command, setCommand] = useState("");
	const [rollbackCommand, setRollbackCommand] = useState("");
	const [tags, setTags] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			await csrfFetch("/api/command-templates", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					...(description.trim() ? { description: description.trim() } : {}),
					command,
					rollbackCommand: rollbackCommand.trim() || null,
					tags: tags
						.split(",")
						.map((tag) => tag.trim())
						.filter(Boolean),
				}),
			});
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("templatesPage.error.createFailed"));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} data-card className="space-y-4 p-5">
			<h3 className="text-lg font-semibold text-[var(--text-primary)]">
				{t("templatesPage.create.title")}
			</h3>
			{error && (
				<div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-sm text-[var(--danger)]">
					{error}
				</div>
			)}
			<FormField label={t("templatesPage.create.nameLabel")} htmlFor={`${createFormId}-name`}>
				<input
					id={`${createFormId}-name`}
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
					placeholder={t("templatesPage.create.namePlaceholder")}
					className={UI_INPUT}
				/>
			</FormField>
			<FormField
				label={t("templatesPage.create.descLabel")}
				htmlFor={`${createFormId}-description`}
			>
				<input
					id={`${createFormId}-description`}
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder={t("templatesPage.create.descPlaceholder")}
					className={UI_INPUT}
				/>
			</FormField>
			<FormField
				label={t("templatesPage.create.commandLabel")}
				htmlFor={`${createFormId}-command`}
				hint={t("templatesPage.create.commandHint")}
			>
				<textarea
					id={`${createFormId}-command`}
					value={command}
					onChange={(e) => setCommand(e.target.value)}
					required
					rows={3}
					placeholder={t("templatesPage.create.commandPlaceholder")}
					className={cn(UI_INPUT, "resize-y font-mono")}
				/>
			</FormField>
			<FormField
				label={t("templatesPage.create.rollbackLabel")}
				htmlFor={`${createFormId}-rollback-command`}
				hint={t("templatesPage.create.rollbackHint")}
			>
				<textarea
					id={`${createFormId}-rollback-command`}
					value={rollbackCommand}
					onChange={(e) => setRollbackCommand(e.target.value)}
					rows={3}
					placeholder={t("templatesPage.create.rollbackPlaceholder")}
					data-tone="emerald"
					className={cn(
						UI_INPUT,
						"resize-y font-mono border-[var(--success-border)] focus:border-[var(--success-border)]",
					)}
				/>
			</FormField>
			<FormField label={t("templatesPage.create.tagsLabel")} htmlFor={`${createFormId}-tags`}>
				<input
					id={`${createFormId}-tags`}
					value={tags}
					onChange={(e) => setTags(e.target.value)}
					placeholder={t("templatesPage.create.tagsPlaceholder")}
					className={UI_INPUT}
				/>
			</FormField>
			<div className="flex gap-3 pt-2">
				<button
					type="submit"
					disabled={submitting}
					data-action-button
					data-variant="primary"
					className="min-h-11 px-5 text-sm"
				>
					{submitting ? t("templatesPage.create.submitting") : t("templatesPage.create.submit")}
				</button>
				<ActionButton type="button" variant="secondary" onClick={onClose} className="min-h-11 px-5 text-sm">
					{t("templatesPage.action.cancel")}
				</ActionButton>
			</div>
		</form>
	);
}
