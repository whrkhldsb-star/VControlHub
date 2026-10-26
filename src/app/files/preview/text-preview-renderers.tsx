"use client";

import { useEffect, useMemo, useState, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from "react";
import { highlightSearchTerm } from "./text-preview-highlight";
import { FindBarLazy } from "./find-bar-lazy";
import { EditorFindBar } from "./editor-find-bar";
import type { EditorFindState, PreviewMetaState } from "./text-preview-types";
import { langLabel } from "./text-preview-helpers";
import { ActionButton } from "@/components/action-button";
import { Search } from "@/components/icons";
import { Badge } from "@/components/ui-primitives";

type T = (key: string, vars?: Record<string, string | number>) => string;

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
			<Badge tone="accent">{langLabel(t, lang)}</Badge>
			<span className="text-xs text-[var(--text-muted)]">{t("textPreview.linesCount", { count: totalLines })}</span>
			{canEdit ? <Badge tone="success">{t("textPreview.editHint")}</Badge> : null}
			{saveMessage ? <span role={saveStatus === "error" ? "alert" : "status"} className={`text-xs ${saveStatus === "error" ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>{saveMessage}{reloadMessage ? <span className="ml-2 text-[var(--text-secondary)]">· {reloadMessage}</span> : null}</span> : null}
			<div className="flex-1" />
			{canEdit ? <div className="flex items-center gap-1">{editMode ? <>
				<ActionButton size="sm" variant="success" onClick={onPreviewSave} disabled={busy || !hasUnsavedChanges}>{saveStatus === "saving" ? t("textPreview.button.saving") : t("textPreview.button.previewSave")}</ActionButton>
				{canReloadAfterSave ? <ActionButton size="sm" variant="warning" onClick={onSaveAndReload} disabled={busy || !hasUnsavedChanges} title={reloadKind === "systemd" ? t("textPreview.reloadHint.systemd", { unit: reloadUnit ?? "" }) : reloadUnit ? t("textPreview.reloadHint.docker", { unit: reloadUnit }) : t("textPreview.reloadHint.dockerProject")}>{saveStatus === "saving" ? t("textPreview.button.saving") : saveStatus === "reloading" ? t("textPreview.button.reloading") : reloadKind === "compose" && !reloadUnit ? t("textPreview.button.saveAndUpdateProject") : t("textPreview.button.saveAndReload", { unit: reloadUnit ?? "" })}</ActionButton> : null}
				<ActionButton size="sm" variant="secondary" onClick={onCancelEdit} disabled={busy}>{t("textPreview.button.cancel")}</ActionButton>
				<ActionButton size="sm" variant="secondary" onClick={onOpenEditorFind} aria-label={t("textPreview.editor.findToggle")} title={t("textPreview.editor.findToggle")}><Search size={14} aria-hidden="true" /></ActionButton>
			</> : <ActionButton size="sm" variant="outline" onClick={onEnterEditMode}>{t("textPreview.button.edit")}</ActionButton>}</div> : null}
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
	/** The read-only view's search; its matches are marked. */
	searchQuery: string;
	sanitizeHighlight: (html: string) => string;
};

/** How long the search box waits for typing to pause before marking matches. */
const SEARCH_MARK_DELAY_MS = 200;

export function TextPreviewBody(props: BodyProps) {
	const { t, editMode, editorFind, draft, lines, lang, showDiffReview, editorFindInputRef, gutterRef, editorRef, containerRef, lineRef, setDraft, setSaveStatus, setSaveMessage, setShowDiffReview, onQueryChange, onMove, onCloseFind, onEditorScroll, onEditorKeyDown, highlightLine, searchQuery, sanitizeHighlight } = props;
	// Highlighted once per text and language; a search revisits only the lines
	// containing it. Every keystroke in the search box used to run the
	// highlighter and the sanitizer over every line: seconds per letter for a
	// file near the 2 MiB preview limit.
	const baseHtml = useMemo(
		() => (editMode ? [] : lines.map((line) => sanitizeHighlight(highlightLine(line, lang)))),
		[editMode, lines, lang, highlightLine, sanitizeHighlight],
	);
	// Marked once typing pauses: sanitizing a marked line parses it, so each
	// letter of a common term would revisit most of a large file.
	const [query, setQuery] = useState(searchQuery);
	useEffect(() => {
		if (query === searchQuery) return;
		const timer = setTimeout(() => setQuery(searchQuery), SEARCH_MARK_DELAY_MS);
		return () => clearTimeout(timer);
	}, [query, searchQuery]);
	const needle = query.trim().toLowerCase();
	const lineHtml = useMemo(
		() => (needle
			? baseHtml.map((html, i) => (lines[i]!.toLowerCase().includes(needle) ? sanitizeHighlight(highlightSearchTerm(highlightLine(lines[i]!, lang), query)) : html))
			: baseHtml),
		[needle, query, baseHtml, lines, lang, highlightLine, sanitizeHighlight],
	);
	if (editMode) {
		return (
			<div className="space-y-2">
				{editorFind.open ? <EditorFindBar inputRef={editorFindInputRef} find={editorFind} onQueryChange={onQueryChange} onMove={onMove} onClose={onCloseFind} /> : null}
				<div data-card="" title={t("textPreview.editor.indentHint")} className="flex min-h-[70vh] overflow-hidden p-0 font-mono text-sm leading-relaxed text-[var(--text-primary)] focus-within:border-[var(--color-action-border)]">
					<div ref={gutterRef} aria-hidden data-testid="editor-line-gutter" className="select-none overflow-hidden border-r border-[var(--border)]/[0.10] bg-[var(--surface)]/70 px-2 py-4 text-right text-[var(--text-muted)]" style={{ minWidth: "3rem" }}>{Array.from({ length: draft.split("\n").length }, (_, i) => <div key={i} className="leading-relaxed">{i + 1}</div>)}</div>
					<textarea ref={editorRef} aria-label={t("textPreview.editAria")} value={draft} onChange={(event) => { setDraft(event.currentTarget.value); setSaveStatus("idle"); setSaveMessage(""); }} onClick={() => showDiffReview && setShowDiffReview(false)} onScroll={onEditorScroll} onKeyDown={onEditorKeyDown} className="min-h-[70vh] w-full resize-none bg-[var(--surface)] p-4 font-mono text-sm leading-relaxed text-[var(--text-primary)] outline-none" spellCheck={false} />
				</div>
			</div>
		);
	}
	return (
		<div ref={containerRef} className="max-h-[75vh] overflow-auto rounded-xl bg-[var(--surface)] p-3 text-sm leading-relaxed sm:p-4">
			<pre className="font-mono text-[var(--text-secondary)]"><code>{lines.map((_line, i) => { const html = lineHtml[i] ?? ""; return <div key={i} ref={(el) => { if (el) lineRef.current.set(i, el); else lineRef.current.delete(i); }} className="flex transition-colors duration-500"><span className="mr-3 inline-block w-6 shrink-0 select-none text-right text-[var(--text-muted)] sm:mr-4 sm:w-12">{i + 1}</span><span className="whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: html }} /></div>; })}</code></pre>
		</div>
	);
}
