"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { DiffReviewDialog } from "./diff-review-dialog";
import {
	getLangFromName,
	highlightLine,
	buildLineDiff,
} from "./syntax-highlighter";
import type {
	PreviewState,
	PreviewMetaState,
	EditorFindState,
	EditableDraft,
	SaveResponse,
} from "./text-preview-types";
import { INITIAL_PREVIEW_META, INITIAL_EDITOR_FIND } from "./text-preview-types";
import { countMatches, TAB_INDENT } from "./text-preview-helpers";
import { TextPreviewBody, TextPreviewToolbar } from "./text-preview-renderers";
import { TextPreviewError, TextPreviewLoading } from "./text-preview-states";
import { highlightSearchTerm } from "./text-preview-highlight";

export function TextPreviewClient({
	href,
	name,
	fileEntryId,
	editable = false,
	driver,
	nodeId,
	relativePath,
	serverId,
	reloadUnit,
	reloadKind,
}: {
	href: string;
	name?: string;
	fileEntryId?: string;
	editable?: boolean;
	driver?: string;
	nodeId?: string;
	relativePath?: string;
	serverId?: string;
	reloadUnit?: string;
	reloadKind?: "systemd" | "compose";
}) {
	const { t } = useI18n();
	const [state, setState] = useState<PreviewState>({ loading: true });
	const [sanitizeHighlight, setSanitizeHighlight] = useState<((html: string) => string) | null>(null);

	useEffect(() => {
		let cancelled = false;
		import("@/lib/sanitize/html-sanitizer").then((m) => {
			if (!cancelled) setSanitizeHighlight(() => m.sanitizeHighlightHtml);
		});
		return () => { cancelled = true; };
	}, []);

	const [loadVersion, resetForLoad] = useReducer((value: number) => value + 1, 0);
	const [searchQuery, setSearchQuery] = useState("");
	const [jumpLine, setJumpLine] = useState("");
	const [previewMeta, setPreviewMeta] = useState<PreviewMetaState>(INITIAL_PREVIEW_META);
	const [draft, setDraft] = useState("");
	const [draftVersion, setDraftVersion] = useState<{ updatedAt?: string | null; lastModifiedMs?: number | null }>({});
	const { editMode, showDiffReview, saveStatus, saveMessage, reloadMessage } = previewMeta;
	const setEditMode = useCallback((editMode: boolean) => {
		setPreviewMeta((current) => ({ ...current, editMode }));
	}, []);
	const setShowDiffReview = useCallback((showDiffReview: boolean) => {
		setPreviewMeta((current) => ({ ...current, showDiffReview }));
	}, []);
	const setSaveStatus = useCallback((saveStatus: PreviewMetaState["saveStatus"]) => {
		setPreviewMeta((current) => ({ ...current, saveStatus }));
	}, []);
	const setSaveMessage = useCallback((saveMessage: string) => {
		setPreviewMeta((current) => ({ ...current, saveMessage }));
	}, []);
	const setReloadMessage = useCallback((reloadMessage: string) => {
		setPreviewMeta((current) => ({ ...current, reloadMessage }));
	}, []);
	const lineRef = useRef<Map<number, HTMLDivElement>>(new Map());
	const containerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const gutterRef = useRef<HTMLDivElement>(null);
	const editorFindInputRef = useRef<HTMLInputElement>(null);
	const didMountRef = useRef(false);
	const [editorFind, setEditorFind] = useState<EditorFindState>(INITIAL_EDITOR_FIND);

	const lang = useMemo(() => getLangFromName(name), [name]);
	const canEdit = editable && Boolean(fileEntryId);
	const currentContent = state.loading ? "" : state.content ?? "";
	const diffRows = useMemo(() => buildLineDiff(currentContent, draft), [currentContent, draft]);
	const diffSummary = useMemo(() => ({
		added: diffRows.filter((row) => row.kind === "added").length,
		removed: diffRows.filter((row) => row.kind === "removed").length,
		changed: diffRows.filter((row) => row.kind === "changed").length,
	}), [diffRows]);

	useEffect(() => {
		if (!didMountRef.current) {
			didMountRef.current = true;
			return;
		}
		resetForLoad();
	}, [href, fileEntryId, canEdit]);

	useEffect(() => {
		let cancelled = false;

		const load = async () => {
			try {
				let content: string;
				let nextDraftVersion: { updatedAt?: string | null; lastModifiedMs?: number | null } = {};
				if (canEdit && fileEntryId) {
					const data = await csrfFetch<{ draft: EditableDraft }>(`/api/files/editable/${fileEntryId}`);
					content = data.draft.content;
					nextDraftVersion = {
						updatedAt: data.draft.updatedAt,
						lastModifiedMs: data.draft.lastModifiedMs,
					};
				} else {
					const res = await fetch(href);
					if (!res.ok) throw new Error(t("textPreview.error.loadFailedStatus").replace("{status}", String(res.status)));
					content = await res.text();
				}
				if (!cancelled) {
					setState({ loading: false, content, error: null });
					setDraft(content);
					setDraftVersion(nextDraftVersion);
				}
			} catch (err) {
				if (!cancelled) {
					setState({
						loading: false,
						content: null,
						error: err instanceof Error ? err.message : t("textPreview.error.loadFailed"),
					});
				}
			}
		};

		load();
		return () => {
			cancelled = true;
		};
	}, [href, fileEntryId, canEdit, loadVersion, t]);

	const handleJumpToLine = useCallback(() => {
		const num = parseInt(jumpLine, 10);
		if (isNaN(num) || num < 1) return;
		const el = lineRef.current.get(num - 1);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "center" });
			el.classList.add("bg-[var(--warning-bg)]");
			setTimeout(() => el.classList.remove("bg-[var(--warning-bg)]"), 2000);
		}
	}, [jumpLine]);

	const handleEditorScroll = useCallback(() => {
		if (gutterRef.current && editorRef.current) {
			gutterRef.current.scrollTop = editorRef.current.scrollTop;
		}
	}, []);

	const applyTabIndent = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		const textarea = event.currentTarget;
		const { selectionStart, selectionEnd, value } = textarea;
		event.preventDefault();
		if (event.shiftKey) {
			// Unindent: strip one leading TAB_INDENT from each selected line
			const before = value.slice(0, selectionStart);
			const lineStart = before.lastIndexOf("\n") + 1;
			const endLineEnd = (() => {
				if (selectionStart === selectionEnd) return value.length;
				const idx = value.indexOf("\n", selectionEnd);
				return idx === -1 ? value.length : idx;
			})();
			const block = value.slice(lineStart, endLineEnd);
			const lines = block.split("\n");
			let removed = 0;
			const updated = lines.map((line) => {
				if (line.startsWith(TAB_INDENT)) {
					removed += TAB_INDENT.length;
					return line.slice(TAB_INDENT.length);
				}
				return line;
			});
			const newBlock = updated.join("\n");
			const newValue = value.slice(0, lineStart) + newBlock + value.slice(lineStart + block.length);
			const newSelectionStart = Math.max(lineStart, selectionStart - TAB_INDENT.length);
			const newSelectionEnd = Math.max(selectionStart, selectionEnd - removed);
			setDraft(newValue);
			requestAnimationFrame(() => {
				textarea.setSelectionRange(newSelectionStart, newSelectionEnd);
			});
		} else {
			// Indent: insert TAB_INDENT at selection start, or at start of each selected line
			if (selectionStart === selectionEnd) {
				const newValue = value.slice(0, selectionStart) + TAB_INDENT + value.slice(selectionStart);
				setDraft(newValue);
				requestAnimationFrame(() => {
					textarea.setSelectionRange(selectionStart + TAB_INDENT.length, selectionStart + TAB_INDENT.length);
				});
			} else {
				const before = value.slice(0, selectionStart);
				const lineStart = before.lastIndexOf("\n") + 1;
				const endLineEnd = (() => {
					const idx = value.indexOf("\n", selectionEnd);
					return idx === -1 ? value.length : idx;
				})();
				const block = value.slice(lineStart, endLineEnd);
				const updated = block.split("\n").map((line) => TAB_INDENT + line).join("\n");
				const newValue = value.slice(0, lineStart) + updated + value.slice(endLineEnd);
				const newSelectionStart = selectionStart + TAB_INDENT.length;
				const newSelectionEnd = selectionEnd + (updated.length - block.length);
				setDraft(newValue);
				requestAnimationFrame(() => {
					textarea.setSelectionRange(newSelectionStart, newSelectionEnd);
				});
			}
		}
	}, []);

	const handleEditorKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Tab") {
			applyTabIndent(event);
			return;
		}
		if (event.key === "Escape" && editorFind.open) {
			event.preventDefault();
			setEditorFind(INITIAL_EDITOR_FIND);
			return;
		}
		if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
			event.preventDefault();
			setEditorFind((current) => {
				if (current.open) {
					editorFindInputRef.current?.focus();
					editorFindInputRef.current?.select();
					return current;
				}
				return { ...current, open: true };
			});
			requestAnimationFrame(() => {
				editorFindInputRef.current?.focus();
				editorFindInputRef.current?.select();
			});
			return;
		}
	}, [applyTabIndent, editorFind.open]);

	const updateEditorFindQuery = useCallback((query: string) => {
		setEditorFind((current) => {
			const total = countMatches(draft, query);
			// Reset current to 0 so the first "next" click lands on occurrence #1.
			return { ...current, query, total, current: 0 };
		});
	}, [draft]);

	const moveEditorFind = useCallback((direction: 1 | -1) => {
		setEditorFind((current) => {
			if (current.total === 0) return current;
			// When no match is currently selected (current=0), the first navigation
			// lands on occurrence #1 (or #total for prev). After that, advance with wrap.
			const next = current.current === 0
				? (direction === 1 ? 1 : current.total)
				: ((current.current - 1 + direction + current.total) % current.total) + 1;
			const textarea = editorRef.current;
			if (textarea) {
				let scan = 0;
				let foundIdx = -1;
				let occurrence = 0;
				while (occurrence < next) {
					foundIdx = draft.indexOf(current.query, scan);
					if (foundIdx === -1) break;
					occurrence += 1;
					scan = foundIdx + current.query.length;
				}
				if (foundIdx >= 0) {
					textarea.focus();
					textarea.setSelectionRange(foundIdx, foundIdx + current.query.length);
				}
			}
			return { ...current, current: next };
		});
	}, [draft]);

	const closeEditorFind = useCallback(() => {
		setEditorFind(INITIAL_EDITOR_FIND);
		editorRef.current?.focus();
	}, []);

	/**
	 * Persist the current draft to its backend (LOCAL fs or SFTP node).
	 * Returns the resulting byte size on success, or null on failure.
	 * Side-effects: sets state (content, draftVersion, editMode, showDiffReview,
	 * saveStatus, saveMessage) so the user sees save progress.
	 */
	const performSave = useCallback(async (): Promise<number | null> => {
		if (!fileEntryId) return null;
		setSaveStatus("saving");
		setSaveMessage("");
		setReloadMessage("");
		try {
			if (driver === "SFTP" && nodeId && relativePath) {
				const response = await csrfFetch<{ success: boolean; byteSize: number }>(
					`/api/storage/sftp-ops`,
					{
						method: "POST",
						body: JSON.stringify({
							action: "write",
							nodeId,
							path: relativePath,
							content: draft,
						}),
					}
				);
				setState({ loading: false, content: draft, error: null });
				setDraftVersion({
					updatedAt: new Date().toISOString(),
					lastModifiedMs: Date.now(),
				});
				setEditMode(false);
				setShowDiffReview(false);
				setSaveStatus("saved");
				setSaveMessage(t("textPreview.saved.success").replace("{bytes}", String(response.byteSize)));
				return response.byteSize;
				}
				const response = await csrfFetch<SaveResponse>(`/api/files/editable/${fileEntryId}`, {
				method: "PUT",
				body: JSON.stringify({
					content: draft,
					expectedUpdatedAt: draftVersion.updatedAt,
					expectedLastModifiedMs: draftVersion.lastModifiedMs,
				}),
			});
			setState({ loading: false, content: draft, error: null });
			setDraftVersion({
				updatedAt: response.file.updatedAt,
				lastModifiedMs: response.file.lastModifiedMs,
			});
			setEditMode(false);
			setShowDiffReview(false);
			setSaveStatus("saved");
			setSaveMessage(t("textPreview.saved.success").replace("{bytes}", String(response.file.byteSize)));
			return response.file.byteSize;
		} catch (err) {
			setSaveStatus("error");
			setSaveMessage(err instanceof Error ? err.message : t("textPreview.error.saveFailed"));
			return null;
		}
	}, [driver, nodeId, relativePath, draft, draftVersion.lastModifiedMs, draftVersion.updatedAt, fileEntryId, setEditMode, setReloadMessage, setSaveMessage, setSaveStatus, setShowDiffReview, t]);

	const handleSave = useCallback(async () => {
		await performSave();
	}, [performSave]);

	const canReloadAfterSave = Boolean(
		driver === "SFTP" &&
		serverId &&
		reloadUnit &&
		reloadKind &&
		editMode,
	);

	const handleSaveAndReload = useCallback(async () => {
		const bytes = await performSave();
		if (bytes === null) return;
		if (!serverId || !reloadUnit || !reloadKind) return;
		setSaveStatus("reloading");
		setReloadMessage("");
		try {
			const body =
				reloadKind === "compose"
					? { kind: "compose" as const, projectDir: relativePath ? `/${relativePath.split("/").slice(0, -1).join("/") || "root"}` : "/", service: reloadUnit }
					: { kind: "systemd" as const, unit: reloadUnit };
			const response = await csrfFetch<{
				success: boolean;
				exitCode: number | null;
				stdout?: string;
				stderr?: string;
			}>(`/api/servers/${serverId}/reload`, {
				method: "POST",
				body: JSON.stringify(body),
			});
			if (response.success) {
				setSaveStatus("reloaded");
				setSaveMessage(t("textPreview.saved.reloaded").replace("{bytes}", String(bytes)));
				setReloadMessage(t("textPreview.reloaded.message"));
				} else {
				setSaveStatus("error");
				setSaveMessage(t("textPreview.saved.reloadedFailed").replace("{bytes}", String(bytes)));
				setReloadMessage(
					`exit=${response.exitCode ?? "?"}${response.stderr ? ` · ${response.stderr.split("\n")[0]?.slice(0, 200) ?? ""}` : ""}`,
				);
				}
				} catch (err) {
				setSaveStatus("error");
				setSaveMessage(t("textPreview.saved.reloadFailed").replace("{bytes}", String(bytes)));
				setReloadMessage(err instanceof Error ? err.message : t("textPreview.error.reloadFailed"));
				}
	}, [performSave, serverId, reloadUnit, reloadKind, relativePath, setSaveMessage, setSaveStatus, setReloadMessage, t]);

	if (state.loading) {
		return <TextPreviewLoading label={t("textPreview.loading")} />;
	}

	if (state.error) {
		return <TextPreviewError message={state.error} />;
	}

	if (!sanitizeHighlight) {
		return <TextPreviewLoading label={t("textPreview.loading")} />;
	}

	const lines = currentContent.split("\n");
	const totalLines = lines.length;
	const hasUnsavedChanges = draft !== currentContent;
	const highlightSearch = (html: string): string => highlightSearchTerm(html, searchQuery);

	return (
		<div className="space-y-3">
			<TextPreviewToolbar
				t={t}
				lang={lang}
				totalLines={totalLines}
				canEdit={canEdit}
				editMode={editMode}
				saveStatus={saveStatus}
				saveMessage={saveMessage}
				reloadMessage={reloadMessage}
				hasUnsavedChanges={hasUnsavedChanges}
				canReloadAfterSave={canReloadAfterSave}
				reloadKind={reloadKind}
				reloadUnit={reloadUnit}
				searchQuery={searchQuery}
				jumpLine={jumpLine}
				setSearchQuery={setSearchQuery}
				setJumpLine={setJumpLine}
				onJumpToLine={handleJumpToLine}
				onPreviewSave={() => setShowDiffReview(true)}
				onSaveAndReload={handleSaveAndReload}
				onCancelEdit={() => {
					setDraft(currentContent);
					setEditMode(false);
					setShowDiffReview(false);
					setSaveStatus("idle");
					setSaveMessage("");
					setReloadMessage("");
				}}
				onOpenEditorFind={() => setEditorFind({ open: true, query: "", total: 0, current: 0 })}
				onEnterEditMode={() => setEditMode(true)}
			/>

			{editMode && showDiffReview ? (
				<DiffReviewDialog
					diffRows={diffRows}
					diffSummary={diffSummary}
					saveStatus={saveStatus}
					canReloadAfterSave={canReloadAfterSave}
					reloadKind={reloadKind}
					reloadUnit={reloadUnit}
					onClose={() => setShowDiffReview(false)}
					onSave={handleSave}
					onSaveAndReload={handleSaveAndReload}
				/>
			) : null}

			<TextPreviewBody
				t={t}
				editMode={editMode}
				editorFind={editorFind}
				draft={draft}
				lines={lines}
				lang={lang}
				showDiffReview={showDiffReview}
				editorFindInputRef={editorFindInputRef}
				gutterRef={gutterRef}
				editorRef={editorRef}
				containerRef={containerRef}
				lineRef={lineRef}
				setDraft={setDraft}
				setSaveStatus={setSaveStatus}
				setSaveMessage={setSaveMessage}
				setShowDiffReview={setShowDiffReview}
				onQueryChange={updateEditorFindQuery}
				onMove={moveEditorFind}
				onCloseFind={closeEditorFind}
				onEditorScroll={handleEditorScroll}
				onEditorKeyDown={handleEditorKeyDown}
				highlightLine={highlightLine}
				highlightSearch={highlightSearch}
				sanitizeHighlight={sanitizeHighlight}
			/>
		</div>
	);
}
