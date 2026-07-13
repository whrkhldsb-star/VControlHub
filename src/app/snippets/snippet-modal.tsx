"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";

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
	const dialogRef = useDialogFocus<HTMLDivElement>({ open: true, onClose });
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
			onClose();
		} catch (cause) {
			const fallback = mode === "create" ? "snippetsPage.toast.createFailed" : "snippetsPage.toast.saveFailed";
			setError(cause instanceof Error ? cause.message : t(fallback));
		} finally {
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
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={`${prefix}-snippet-title`}
				className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-6 shadow-2xl"
				onClick={(event) => event.stopPropagation()}
			>
				<h3 id={`${prefix}-snippet-title`} className="text-lg font-semibold text-[var(--text-primary)]">
					{t(`snippetsPage.modal.${prefix}Title`)}
				</h3>
				<div className="mt-4 space-y-3">
					{fields.map((field) => (
						<div key={field.name}>
							<label htmlFor={fieldId(field.name)} className="block text-xs text-[var(--text-muted)]">{t(field.label)}</label>
							<input
								id={fieldId(field.name)}
								value={field.value}
								onChange={(event) => field.setValue(event.target.value)}
								placeholder={field.hint ? t(field.hint) : undefined}
								autoFocus={field.autoFocus}
								data-input
								className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
							/>
						</div>
					))}
					<div>
						<label htmlFor={fieldId("content")} className="block text-xs text-[var(--text-muted)]">{t("snippetsPage.modal.field.content")}</label>
						<textarea id={fieldId("content")} value={content} onChange={(event) => setContent(event.target.value)} rows={10} data-input className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs outline-none" />
					</div>
					<label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
						<input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} className="rounded-lg border-[var(--border)]" />
						{t("snippetsPage.modal.field.private")}
					</label>
				</div>
				{error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
				<div className="mt-5 flex justify-end gap-3">
					<button onClick={onClose} className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-muted)] transition hover:bg-[var(--surface)]/10">{t("snippetsPage.modal.action.cancel")}</button>
					<button onClick={handleSave} disabled={saving || !title.trim() || !content.trim()} className="min-h-11 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-40">
						{t(`snippetsPage.modal.action.${saving ? (mode === "create" ? "creating" : "saving") : mode === "create" ? "create" : "save"}`)}
					</button>
				</div>
			</div>
		</div>
	);
}
