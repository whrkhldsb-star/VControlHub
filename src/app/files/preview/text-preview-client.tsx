"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { FindBarLazy } from "./find-bar-lazy";
import { EditorFindBar } from "./editor-find-bar";
import { DiffReviewDialog } from "./diff-review-dialog";
import {
	getLangFromName,
	highlightLine,
	escapeHtml,
	escapeRegex,
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
import { countMatches, TAB_INDENT, langLabel } from "./text-preview-helpers";

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
		return (
			<div className="flex items-center justify-center py-16 text-[var(--text-secondary)]">
				<span className="animate-pulse text-sm">{t("textPreview.loading")}</span>
			</div>
		);
	}

	if (state.error) {
		return (
			<div className="flex flex-col items-center gap-3 py-16 text-[var(--danger)]">
				<span className="text-3xl">⚠️</span>
				<p className="text-sm">{state.error}</p>
			</div>
		);
	}

	if (!sanitizeHighlight) {
		return (
			<div className="flex items-center justify-center py-16 text-[var(--text-secondary)]">
				<span className="animate-pulse text-sm">{t("textPreview.loading")}</span>
			</div>
		);
	}

	const lines = currentContent.split("\n");
	const totalLines = lines.length;
	const hasUnsavedChanges = draft !== currentContent;
	const highlightSearch = (html: string): string => {
		if (!searchQuery.trim()) return html;
		try {
			const escapedQuery = escapeHtml(searchQuery);
			const escaped = escapeRegex(escapedQuery);
			return html.replace(new RegExp(`(${escaped})`, "gi"), '<mark class="bg-amber-400/30 text-[var(--warning)] rounded-lg px-0.5">$1</mark>');
		} catch {
			return html;
		}
	};

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="rounded-full bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-300 border border-blue-400/30">
					{langLabel(t, lang)}
				</span>
				<span className="text-xs text-[var(--text-muted)]">{t("textPreview.linesCount").replace("{count}", String(totalLines))}</span>
				{canEdit ? (
					<span data-tone="emerald" className="rounded-lg border border-[var(--success-border)] px-3 py-1 text-xs text-[var(--success)]">
						{t("textPreview.editHint")}
					</span>
				) : null}
				{saveMessage ? (
					<span
						role={saveStatus === "error" ? "alert" : "status"}
						className={`text-xs ${saveStatus === "error" ? "text-[var(--danger)]" : "text-[var(--success)]"}`}
					>
						{saveMessage}
						{reloadMessage ? (
							<span className="ml-2 text-[var(--text-secondary)]">· {reloadMessage}</span>
						) : null}
					</span>
				) : null}
				<div className="flex-1" />
				{canEdit ? (
					<div className="flex items-center gap-1">
						{editMode ? (
							<>
								<button
									type="button"
									onClick={() => setShowDiffReview(true)}
									disabled={saveStatus === "saving" || saveStatus === "reloading" || !hasUnsavedChanges}
									data-tone="emerald" className="rounded-lg border border-[var(--success-border)] px-3 py-1.5 text-xs text-[var(--success)] hover:bg-[var(--success-bg)] disabled:opacity-50"
								>
									{saveStatus === "saving" ? t("textPreview.button.saving") : t("textPreview.button.previewSave")}
								</button>
								{canReloadAfterSave ? (
									<button
										type="button"
										onClick={handleSaveAndReload}
										disabled={saveStatus === "saving" || saveStatus === "reloading" || !hasUnsavedChanges}
										data-tone="amber" className="rounded-lg border border-[var(--warning-border)] px-3 py-1.5 text-xs text-[var(--warning)] hover:bg-[var(--warning-bg)] disabled:opacity-50"
										title={reloadKind === "systemd"
											? t("textPreview.reloadHint.systemd").replace("{unit}", reloadUnit ?? "")
											: t("textPreview.reloadHint.docker").replace("{unit}", reloadUnit ?? "")}
										>
										{saveStatus === "saving"
											? t("textPreview.button.saving")
											: saveStatus === "reloading"
												? t("textPreview.button.reloading")
												: t("textPreview.button.saveAndReload").replace("{unit}", reloadUnit ?? "")}
										</button>
								) : null}
								<button
									type="button"
									onClick={() => {
										setDraft(currentContent);
										setEditMode(false);
										setShowDiffReview(false);
										setSaveStatus("idle");
										setSaveMessage("");
										setReloadMessage("");
									}}
									disabled={saveStatus === "saving" || saveStatus === "reloading"}
									className="rounded-lg border border-slate-700 bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] light:hover:bg-slate-200 disabled:opacity-50"
								>
									{t("textPreview.button.cancel")}
								</button>
								<button
									type="button"
									onClick={() => setEditorFind({ open: true, query: "", total: 0, current: 0 })}
									aria-label={t("textPreview.editor.findToggle")}
									title={t("textPreview.editor.findToggle")}
									className="rounded-lg border border-slate-700 bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] light:hover:bg-slate-200"
								>
									🔍
								</button>
								</>
						) : (
							<button
								type="button"
								onClick={() => setEditMode(true)}
								data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/30 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--color-action-bg)]/20"
							>
								{t("textPreview.button.edit")}
							</button>
						)}
					</div>
				) : null}
				{!editMode ? (
					<FindBarLazy
						searchQuery={searchQuery}
						onSearchQueryChange={setSearchQuery}
						jumpLine={jumpLine}
						onJumpLineChange={setJumpLine}
						onJumpToLine={handleJumpToLine}
					/>
				) : null}
			</div>

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

			{editMode ? (
				<div className="space-y-2">
					{editorFind.open ? (
						<EditorFindBar
							inputRef={editorFindInputRef}
							find={editorFind}
							onQueryChange={updateEditorFindQuery}
							onMove={moveEditorFind}
							onClose={closeEditorFind}
						/>
					) : null}
					<div
						title={t("textPreview.editor.indentHint")}
						className="flex min-h-[70vh] overflow-hidden rounded-2xl border border-[var(--color-action-border)]/30 bg-[var(--surface)] font-mono text-sm leading-relaxed text-[var(--text-primary)] focus-within:border-[var(--color-action-border)]"
					>
						<div
							ref={gutterRef}
							aria-hidden
							data-testid="editor-line-gutter"
							className="select-none overflow-hidden border-r border-[var(--border)]/[0.10] bg-[var(--surface)]/70 px-2 py-4 text-right text-[var(--text-muted)]"
							style={{ minWidth: "3rem" }}
						>
							{Array.from({ length: draft.split("\n").length }, (_, i) => (
								<div key={i} className="leading-relaxed">{i + 1}</div>
							))}
						</div>
						<textarea
							ref={editorRef}
							aria-label={t("textPreview.editAria")}
							value={draft}
							onChange={(event) => {
								setDraft(event.currentTarget.value);
								setSaveStatus("idle");
								setSaveMessage("");
							}}
							onClick={() => showDiffReview && setShowDiffReview(false)}
							onScroll={handleEditorScroll}
							onKeyDown={handleEditorKeyDown}
							className="min-h-[70vh] w-full resize-none bg-[var(--surface)] p-4 font-mono text-sm leading-relaxed text-[var(--text-primary)] outline-none"
							spellCheck={false}
						/>
					</div>
				</div>
			) : (
				<div ref={containerRef} className="overflow-auto rounded-2xl bg-[var(--surface)] p-4 text-sm leading-relaxed max-h-[75vh]">
					<pre className="font-mono text-[var(--text-secondary)]">
						<code>
							{lines.map((line, i) => {
								let html = highlightLine(line, lang);
								html = highlightSearch(html);
								html = sanitizeHighlight(html);
								return (
									<div
										key={i}
										ref={(el) => { if (el) lineRef.current.set(i, el); }}
										className="flex transition-colors duration-500"
									>
										<span className="mr-4 inline-block w-12 select-none text-right text-[var(--text-muted)] shrink-0">
											{i + 1}
										</span>
										<span className="whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: html }} />
									</div>
								);
							})}
						</code>
					</pre>
				</div>
			)}
		</div>
	);
}
