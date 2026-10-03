"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";

import { Dialog } from "@/components/ui/dialog";
import { CheckboxField, FormField, Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";

import { ActionButton } from "@/components/action-button";
import { getErrorMessage } from "@/lib/http/error-message";
export interface SnippetFormValue {
	id: string;
	title: string;
	content: string;
	language: string;
	description: string | null;
	tags: string[];
	isPrivate: boolean;
}

const EMPTY_SNIPPET: SnippetFormValue = {
	id: "",
	title: "",
	content: "",
	language: "",
	description: null,
	tags: [],
	isPrivate: false,
};

export function SnippetModal({
	mode,
	snippet = EMPTY_SNIPPET,
	onClose,
	onSaved,
}: {
	mode: "create" | "edit";
	snippet?: SnippetFormValue;
	onClose: () => void;
	onSaved: (snippet: SnippetFormValue) => void;
}) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const prefix = mode === "create" ? "create" : "edit";
	const savingRef = useRef(false);
	const requestClose = () => {
		if (savingRef.current) return;
		onClose();
	};
	const [title, setTitle] = useState(snippet.title);
	const [content, setContent] = useState(snippet.content);
	const [language, setLanguage] = useState(snippet.language);
	const [description, setDescription] = useState(snippet.description ?? "");
	const [tagsInput, setTagsInput] = useState(snippet.tags.join(", "));
	const [isPrivate, setIsPrivate] = useState(snippet.isPrivate);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	const fieldId = (name: string) => `${prefix}-snippet-${name}-input`;

	async function handleSave() {
		if (savingRef.current) return;
		savingRef.current = true;
		setSaving(true);
		setError("");
		try {
			const tags = tagsInput.split(",").map((tag) => tag.trim()).filter(Boolean);
			const payload = {
				...(mode === "edit" ? { id: snippet.id } : {}),
				title,
				content,
				language: language.trim() || undefined,
				description: description.trim() || undefined,
				tags: tags.length ? tags : undefined,
				isPrivate,
			};
			const data = await csrfFetch<{ snippet: SnippetFormValue }>("/api/snippets", {
				method: mode === "create" ? "POST" : "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			onSaved(data.snippet);
			if (mode === "edit") addToast("success", t("snippetsPage.toast.saved"));
			// Clear saving gate before close so requestClose is not blocked.
			savingRef.current = false;
			setSaving(false);
			onClose();
		} catch (cause) {
			const fallback = mode === "create" ? "snippetsPage.toast.createFailed" : "snippetsPage.toast.saveFailed";
			setError(getErrorMessage(cause, t(fallback)));
			savingRef.current = false;
			setSaving(false);
		}
	}

	const fields: Array<{
		name: string;
		value: string;
		setValue: Dispatch<SetStateAction<string>>;
		label: string;
		hint?: string;
		autoFocus?: boolean;
	}> = [
		{ name: "title", value: title, setValue: setTitle, label: "snippetsPage.modal.field.title", autoFocus: mode === "create" },
		{ name: "language", value: language, setValue: setLanguage, label: "snippetsPage.modal.field.language", hint: "snippetsPage.modal.field.languageHint" },
		{ name: "description", value: description, setValue: setDescription, label: "snippetsPage.modal.field.description", hint: "snippetsPage.modal.field.descriptionHint" },
		{ name: "tags", value: tagsInput, setValue: setTagsInput, label: "snippetsPage.modal.field.tags", hint: "snippetsPage.modal.field.tagsHint" },
	];

	return (
		<Dialog
			size="lg"
			open
			onClose={requestClose}
			closeOnBackdrop={false}
			busy={saving}
			title={t(`snippetsPage.modal.${prefix}Title`)}
			footer={<>
				<ActionButton type="button" variant="secondary" onClick={requestClose} disabled={saving}>
					{t("snippetsPage.modal.action.cancel")}
				</ActionButton>
				<ActionButton type="button" onClick={handleSave} loading={saving} disabled={!title.trim() || !content.trim()}>
					{t(`snippetsPage.modal.action.${saving ? (mode === "create" ? "creating" : "saving") : mode === "create" ? "create" : "save"}`)}
				</ActionButton>
			</>}
		>
			<div className="space-y-4">
				{error ? <Notice tone="danger" compact>{error}</Notice> : null}
				{fields.map((field) => (
					<FormField key={field.name} label={t(field.label)} htmlFor={fieldId(field.name)}>
						<input
							id={fieldId(field.name)}
							value={field.value}
							onChange={(event) => field.setValue(event.target.value)}
							placeholder={field.hint ? t(field.hint) : undefined}
							autoFocus={field.autoFocus}
							className={UI_INPUT}
						/>
					</FormField>
				))}
				<FormField label={t("snippetsPage.modal.field.content")} htmlFor={fieldId("content")}>
					<textarea id={fieldId("content")} value={content} onChange={(event) => setContent(event.target.value)} rows={10} className={cn(UI_INPUT, "font-mono text-xs")} />
				</FormField>
				<CheckboxField label={t("snippetsPage.modal.field.private")} checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
			</div>
		</Dialog>
	);
}
