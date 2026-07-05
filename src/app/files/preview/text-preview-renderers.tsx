"use client";

import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from "react";
import { FindBarLazy } from "./find-bar-lazy";
import { EditorFindBar } from "./editor-find-bar";
import type { EditorFindState, PreviewMetaState } from "./text-preview-types";
import { langLabel } from "./text-preview-helpers";

type T = (key: string) => string;

type ToolbarProps = {
	t: T;
	lang: string;
	totalLines: number;
	canEdit: boolean;
	editMode: boolean;
	saveStatus: PreviewMetaState["saveStatus"];
	saveMessage: string;
	reloadMessage: string;
	hasUnsavedChanges: boolean;
	canReloadAfterSave: boolean;
	reloadKind?: "systemd" | "compose";
	reloadUnit?: string;
	searchQuery: string;
	jumpLine: string;
	setSearchQuery: Dispatch<SetStateAction<string>>;
	setJumpLine: Dispatch<SetStateAction<string>>;
	onJumpToLine: () => void;
	onPreviewSave: () => void;
	onSaveAndReload: () => void;
	onCancelEdit: () => void;
	onOpenEditorFind: () => void;
	onEnterEditMode: () => void;
};

export function TextPreviewToolbar(props: ToolbarProps) {
	const { t, lang, totalLines, canEdit, editMode, saveStatus, saveMessage, reloadMessage, hasUnsavedChanges, canReloadAfterSave, reloadKind, reloadUnit, searchQuery, jumpLine, setSearchQuery, setJumpLine, onJumpToLine, onPreviewSave, onSaveAndReload, onCancelEdit, onOpenEditorFind, onEnterEditMode } = props;
	const busy = saveStatus === "saving" || saveStatus === "reloading";
	return (
		<div className="flex flex-wrap items-center gap-2">
			<span className="rounded-full border border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)] px-3 py-1 text-xs font-medium text-[var(--color-action)]">{langLabel(t, lang)}</span>
			<span className="text-xs text-[var(--text-muted)]">{t("textPreview.linesCount").replace("{count}", String(totalLines))}</span>
			{canEdit ? <span data-tone="emerald" className="rounded-lg border border-[var(--success-border)] px-3 py-1 text-xs text-[var(--success)]">{t("textPreview.editHint")}</span> : null}
			{saveMessage ? <span role={saveStatus === "error" ? "alert" : "status"} className={`text-xs ${saveStatus === "error" ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>{saveMessage}{reloadMessage ? <span className="ml-2 text-[var(--text-secondary)]">· {reloadMessage}</span> : null}</span> : null}
			<div className="flex-1" />
			{canEdit ? <div className="flex items-center gap-1">{editMode ? <>
				<button type="button" onClick={onPreviewSave} disabled={busy || !hasUnsavedChanges} data-tone="emerald" className="rounded-lg border border-[var(--success-border)] px-3 py-1.5 text-xs text-[var(--success)] hover:bg-[var(--success-bg)] disabled:opacity-50">{saveStatus === "saving" ? t("textPreview.button.saving") : t("textPreview.button.previewSave")}</button>
				{canReloadAfterSave ? <button type="button" onClick={onSaveAndReload} disabled={busy || !hasUnsavedChanges} data-tone="amber" className="rounded-lg border border-[var(--warning-border)] px-3 py-1.5 text-xs text-[var(--warning)] hover:bg-[var(--warning-bg)] disabled:opacity-50" title={reloadKind === "systemd" ? t("textPreview.reloadHint.systemd").replace("{unit}", reloadUnit ?? "") : t("textPreview.reloadHint.docker").replace("{unit}", reloadUnit ?? "")}>{saveStatus === "saving" ? t("textPreview.button.saving") : saveStatus === "reloading" ? t("textPreview.button.reloading") : t("textPreview.button.saveAndReload").replace("{unit}", reloadUnit ?? "")}</button> : null}
				<button type="button" onClick={onCancelEdit} disabled={busy} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] light:hover:bg-[var(--surface-hover)] disabled:opacity-50">{t("textPreview.button.cancel")}</button>
				<button type="button" onClick={onOpenEditorFind} aria-label={t("textPreview.editor.findToggle")} title={t("textPreview.editor.findToggle")} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] light:hover:bg-[var(--surface-hover)]">🔍</button>
			</> : <button type="button" onClick={onEnterEditMode} data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/30 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--color-action-bg)]/20">{t("textPreview.button.edit")}</button>}</div> : null}
			{!editMode ? <FindBarLazy searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} jumpLine={jumpLine} onJumpLineChange={setJumpLine} onJumpToLine={onJumpToLine} /> : null}
		</div>
	);
}

type BodyProps = {
	t: T;
	editMode: boolean;
	editorFind: EditorFindState;
	draft: string;
	lines: string[];
	lang: string;
	showDiffReview: boolean;
	editorFindInputRef: RefObject<HTMLInputElement | null>;
	gutterRef: RefObject<HTMLDivElement | null>;
	editorRef: RefObject<HTMLTextAreaElement | null>;
	containerRef: RefObject<HTMLDivElement | null>;
	lineRef: RefObject<Map<number, HTMLDivElement>>;
	setDraft: Dispatch<SetStateAction<string>>;
	setSaveStatus: (status: PreviewMetaState["saveStatus"]) => void;
	setSaveMessage: (message: string) => void;
	setShowDiffReview: (open: boolean) => void;
	onQueryChange: (query: string) => void;
	onMove: (direction: 1 | -1) => void;
	onCloseFind: () => void;
	onEditorScroll: () => void;
	onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	highlightLine: (line: string, lang: string) => string;
	highlightSearch: (html: string) => string;
	sanitizeHighlight: (html: string) => string;
};

export function TextPreviewBody(props: BodyProps) {
	const { t, editMode, editorFind, draft, lines, lang, showDiffReview, editorFindInputRef, gutterRef, editorRef, containerRef, lineRef, setDraft, setSaveStatus, setSaveMessage, setShowDiffReview, onQueryChange, onMove, onCloseFind, onEditorScroll, onEditorKeyDown, highlightLine, highlightSearch, sanitizeHighlight } = props;
	if (editMode) {
		return (
			<div className="space-y-2">
				{editorFind.open ? <EditorFindBar inputRef={editorFindInputRef} find={editorFind} onQueryChange={onQueryChange} onMove={onMove} onClose={onCloseFind} /> : null}
				<div title={t("textPreview.editor.indentHint")} className="flex min-h-[70vh] overflow-hidden rounded-2xl border border-[var(--color-action-border)]/30 bg-[var(--surface)] font-mono text-sm leading-relaxed text-[var(--text-primary)] focus-within:border-[var(--color-action-border)]">
					<div ref={gutterRef} aria-hidden data-testid="editor-line-gutter" className="select-none overflow-hidden border-r border-[var(--border)]/[0.10] bg-[var(--surface)]/70 px-2 py-4 text-right text-[var(--text-muted)]" style={{ minWidth: "3rem" }}>{Array.from({ length: draft.split("\n").length }, (_, i) => <div key={i} className="leading-relaxed">{i + 1}</div>)}</div>
					<textarea ref={editorRef} aria-label={t("textPreview.editAria")} value={draft} onChange={(event) => { setDraft(event.currentTarget.value); setSaveStatus("idle"); setSaveMessage(""); }} onClick={() => showDiffReview && setShowDiffReview(false)} onScroll={onEditorScroll} onKeyDown={onEditorKeyDown} className="min-h-[70vh] w-full resize-none bg-[var(--surface)] p-4 font-mono text-sm leading-relaxed text-[var(--text-primary)] outline-none" spellCheck={false} />
				</div>
			</div>
		);
	}
	return (
		<div ref={containerRef} className="max-h-[75vh] overflow-auto rounded-2xl bg-[var(--surface)] p-4 text-sm leading-relaxed">
			<pre className="font-mono text-[var(--text-secondary)]"><code>{lines.map((line, i) => { let html = highlightLine(line, lang); html = highlightSearch(html); html = sanitizeHighlight(html); return <div key={i} ref={(el) => { if (el) lineRef.current.set(i, el); }} className="flex transition-colors duration-500"><span className="mr-4 inline-block w-12 shrink-0 select-none text-right text-[var(--text-muted)]">{i + 1}</span><span className="whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: html }} /></div>; })}</code></pre>
		</div>
	);
}
