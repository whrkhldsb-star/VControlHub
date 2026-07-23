"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import {
  buildLineDiff,
  getLangFromName,
} from "./syntax-highlighter";
import type {
  EditableDraft,
  EditorFindState,
  PreviewMetaState,
  PreviewState,
  SaveResponse,
} from "./text-preview-types";
import { INITIAL_EDITOR_FIND, INITIAL_PREVIEW_META } from "./text-preview-types";
import { countMatches, TAB_INDENT } from "./text-preview-helpers";

type TFn = (key: string) => string;

export function useTextPreviewController(options: {
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
  t: TFn;
}) {
  const {
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
    t,
  } = options;

  const [state, setState] = useState<PreviewState>({ loading: true });
  const [sanitizeHighlight, setSanitizeHighlight] = useState<((html: string) => string) | null>(null);
  const [loadVersion, resetForLoad] = useReducer((value: number) => value + 1, 0);
  const [searchQuery, setSearchQuery] = useState("");
  const [jumpLine, setJumpLine] = useState("");
  const [previewMeta, setPreviewMeta] = useState<PreviewMetaState>(INITIAL_PREVIEW_META);
  const [draft, setDraft] = useState("");
  const [draftVersion, setDraftVersion] = useState<{ updatedAt?: string | null; lastModifiedMs?: number | null }>({});
  const [editorFind, setEditorFind] = useState<EditorFindState>(INITIAL_EDITOR_FIND);

  const lineRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const editorFindInputRef = useRef<HTMLInputElement>(null);
  const didMountRef = useRef(false);

  const { editMode, showDiffReview, saveStatus, saveMessage, reloadMessage } = previewMeta;
  const setEditMode = useCallback((next: boolean) => {
    setPreviewMeta((current) => ({ ...current, editMode: next }));
  }, []);
  const setShowDiffReview = useCallback((next: boolean) => {
    setPreviewMeta((current) => ({ ...current, showDiffReview: next }));
  }, []);
  const setSaveStatus = useCallback((next: PreviewMetaState["saveStatus"]) => {
    setPreviewMeta((current) => ({ ...current, saveStatus: next }));
  }, []);
  const setSaveMessage = useCallback((next: string) => {
    setPreviewMeta((current) => ({ ...current, saveMessage: next }));
  }, []);
  const setReloadMessage = useCallback((next: string) => {
    setPreviewMeta((current) => ({ ...current, reloadMessage: next }));
  }, []);

  const lang = useMemo(() => getLangFromName(name), [name]);
  const canEdit = editable && Boolean(fileEntryId);
  const currentContent = state.loading ? "" : state.content ?? "";
  const diffRows = useMemo(() => buildLineDiff(currentContent, draft), [currentContent, draft]);
  const diffSummary = useMemo(
    () => ({
      added: diffRows.filter((row) => row.kind === "added").length,
      removed: diffRows.filter((row) => row.kind === "removed").length,
      changed: diffRows.filter((row) => row.kind === "changed").length,
    }),
    [diffRows],
  );

  useEffect(() => {
    let cancelled = false;
    import("@/lib/sanitize/html-sanitizer").then((m) => {
      if (!cancelled) setSanitizeHighlight(() => m.sanitizeHighlightHtml);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
          if (!res.ok) {
            throw new Error(
              t("textPreview.error.loadFailedStatus").replace("{status}", String(res.status)),
            );
          }
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
    void load();
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

  const applyTabIndent = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;
    event.preventDefault();
    if (event.shiftKey) {
      const before = value.slice(0, selectionStart);
      const lineStart = before.lastIndexOf("\n") + 1;
      const endLineEnd = (() => {
        // Collapsed caret: unindent only the current line (not through EOF).
        const from = selectionStart === selectionEnd ? selectionStart : selectionEnd;
        const idx = value.indexOf("\n", from);
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
    } else if (selectionStart === selectionEnd) {
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
      const updated = block
        .split("\n")
        .map((line) => TAB_INDENT + line)
        .join("\n");
      const newValue = value.slice(0, lineStart) + updated + value.slice(endLineEnd);
      const newSelectionStart = selectionStart + TAB_INDENT.length;
      const newSelectionEnd = selectionEnd + (updated.length - block.length);
      setDraft(newValue);
      requestAnimationFrame(() => {
        textarea.setSelectionRange(newSelectionStart, newSelectionEnd);
      });
    }
  }, []);

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
      }
    },
    [applyTabIndent, editorFind.open],
  );

  const updateEditorFindQuery = useCallback(
    (query: string) => {
      setEditorFind((current) => {
        const total = countMatches(draft, query);
        return { ...current, query, total, current: 0 };
      });
    },
    [draft],
  );

  const moveEditorFind = useCallback(
    (direction: 1 | -1) => {
      setEditorFind((current) => {
        if (current.total === 0) return current;
        const next =
          current.current === 0
            ? direction === 1
              ? 1
              : current.total
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
    },
    [draft],
  );

  const closeEditorFind = useCallback(() => {
    setEditorFind(INITIAL_EDITOR_FIND);
    editorRef.current?.focus();
  }, []);

  const performSave = useCallback(async (): Promise<number | null> => {
    if (!fileEntryId) return null;
    setSaveStatus("saving");
    setSaveMessage("");
    setReloadMessage("");
    try {
      if (driver === "SFTP" && nodeId && relativePath) {
        const response = await csrfFetch<{ success: boolean; byteSize: number }>(`/api/storage/sftp-ops`, {
          method: "POST",
          body: JSON.stringify({
            action: "write",
            nodeId,
            path: relativePath,
            content: draft,
          }),
        });
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
  }, [
    driver,
    nodeId,
    relativePath,
    draft,
    draftVersion.lastModifiedMs,
    draftVersion.updatedAt,
    fileEntryId,
    setEditMode,
    setReloadMessage,
    setSaveMessage,
    setSaveStatus,
    setShowDiffReview,
    t,
  ]);

  const handleSave = useCallback(async () => {
    await performSave();
  }, [performSave]);

  const canReloadAfterSave = Boolean(driver === "SFTP" && serverId && reloadUnit && reloadKind && editMode);

  const handleSaveAndReload = useCallback(async () => {
    const bytes = await performSave();
    if (bytes === null) return;
    if (!serverId || !reloadUnit || !reloadKind) return;
    setSaveStatus("reloading");
    setReloadMessage("");
    try {
      const body =
        reloadKind === "compose"
          ? {
              kind: "compose" as const,
              projectDir: relativePath
                ? `/${relativePath.split("/").slice(0, -1).join("/") || "root"}`
                : "/",
              service: reloadUnit,
            }
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
  }, [
    performSave,
    serverId,
    reloadUnit,
    reloadKind,
    relativePath,
    setSaveMessage,
    setSaveStatus,
    setReloadMessage,
    t,
  ]);

  const cancelEdit = useCallback(() => {
    setDraft(currentContent);
    setEditMode(false);
    setShowDiffReview(false);
    setSaveStatus("idle");
    setSaveMessage("");
    setReloadMessage("");
  }, [currentContent, setEditMode, setReloadMessage, setSaveMessage, setSaveStatus, setShowDiffReview]);

  return {
    state,
    sanitizeHighlight,
    searchQuery,
    setSearchQuery,
    jumpLine,
    setJumpLine,
    draft,
    setDraft,
    editorFind,
    setEditorFind,
    editMode,
    showDiffReview,
    saveStatus,
    saveMessage,
    reloadMessage,
    setEditMode,
    setShowDiffReview,
    setSaveStatus,
    setSaveMessage,
    lang,
    canEdit,
    currentContent,
    diffRows,
    diffSummary,
    lineRef,
    containerRef,
    editorRef,
    gutterRef,
    editorFindInputRef,
    handleJumpToLine,
    handleEditorScroll,
    handleEditorKeyDown,
    updateEditorFindQuery,
    moveEditorFind,
    closeEditorFind,
    handleSave,
    handleSaveAndReload,
    canReloadAfterSave,
    cancelEdit,
  };
}
