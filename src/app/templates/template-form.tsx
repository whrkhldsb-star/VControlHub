"use client";

import { useId, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { FormField, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { getErrorMessage } from "@/lib/http/error-message";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";
import { useToast } from "@/components/toast-provider";
import { changedTemplateFields, type Template, type TemplateFields } from "./template-types";

/**
 * A new template, or the changes to one (`template`): sent as a POST or as a PATCH. A template could not be changed
 * once created — fixing its command meant deleting it and writing it again.
 */
export function TemplateForm({
	template,
	onClose,
}: {
	template?: Template;
	/** `saved`: the template was saved, as opposed to the form being cancelled. */
	onClose: (saved: boolean) => void;
}) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const createFormId = useId();
	const editing = template !== undefined;
	const [name, setName] = useState(template?.name ?? "");
	const [description, setDescription] = useState(template?.description ?? "");
	const [command, setCommand] = useState(template?.command ?? "");
	const [rollbackCommand, setRollbackCommand] = useState(template?.rollbackCommand ?? "");
	const [tags, setTags] = useState(template?.tags.join(", ") ?? "");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Cancel asked nothing and dropped what was typed (the playbook form asks).
	const [dirty, setDirty] = useState(false);
	const { requestDiscard, discardDialog } = useUnsavedChangesGuard({ dirty, onDiscard: () => onClose(false) });

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const fields: TemplateFields = {
				name,
				description: description.trim(),
				command,
				rollbackCommand: rollbackCommand.trim() || null,
				tags: tags
					.split(",")
					.map((tag) => tag.trim())
					.filter(Boolean),
			};
			// An edit sends what changed, and nothing when nothing did.
			const changes = editing ? changedTemplateFields(template, fields) : null;
			if (changes && Object.keys(changes).length === 0) {
				addToast("info", t("templatesPage.toast.unchanged"));
				setDirty(false);
				onClose(false);
				return;
			}
			await csrfFetch("/api/command-templates", {
				method: editing ? "PATCH" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(editing
					? { id: template.id, ...changes }
					: {
						name: fields.name,
						...(fields.description ? { description: fields.description } : {}),
						command: fields.command,
						rollbackCommand: fields.rollbackCommand,
						tags: fields.tags,
					}),
			});
			setDirty(false);
			onClose(true);
		} catch (err) {
			setError(getErrorMessage(err, t(editing ? "templatesPage.error.updateFailed" : "templatesPage.error.createFailed")));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		// The panel around it has the title: the form was a second card under a second "创建命令模板".
		<form onSubmit={handleSubmit} onChangeCapture={() => setDirty(true)} className="space-y-4">
			{error && (
				<Notice tone="danger">{error}</Notice>
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
				<ActionButton variant="primary"
					type="submit"
					disabled={submitting}>
					{editing
						? (submitting ? t("templatesPage.edit.submitting") : t("templatesPage.edit.submit"))
						: (submitting ? t("templatesPage.create.submitting") : t("templatesPage.create.submit"))}
				</ActionButton>
				<ActionButton type="button" variant="secondary" onClick={requestDiscard}>
					{t("templatesPage.action.cancel")}
				</ActionButton>
			</div>
			{discardDialog}
		</form>
	);
}
