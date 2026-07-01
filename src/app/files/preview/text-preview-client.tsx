"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from "react";
import createDOMPurify from "dompurify";
import type { Config } from "dompurify";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { FindBarLazy } from "./find-bar-lazy";

const HIGHLIGHT_SANITIZE_CONFIG: Config = {
	ALLOWED_TAGS: ["span", "br"],
	ALLOWED_ATTR: ["class"],
	ALLOW_DATA_ATTR: false,
};

function purifyHtml(html: string, config: Config): string {
	const purifier = typeof createDOMPurify.sanitize === "function"
		? createDOMPurify
		: typeof window !== "undefined"
			? createDOMPurify(window)
			: null;

	return purifier?.sanitize(html, config) ?? html;
}

/** Sanitize syntax-highlighted HTML — allow span tags for color classes */
function sanitizeHighlightHtml(html: string): string {
	return purifyHtml(html, HIGHLIGHT_SANITIZE_CONFIG);
}

type PreviewState = { loading: true } | { loading: false; content: string | null; error: string | null };
type PreviewMetaState = {
	editMode: boolean;
	showDiffReview: boolean;
	saveStatus: "idle" | "saving" | "saved" | "reloading" | "reloaded" | "error";
	saveMessage: string;
	reloadMessage: string;
};

const INITIAL_PREVIEW_META: PreviewMetaState = {
	editMode: false,
	showDiffReview: false,
	saveStatus: "idle",
	saveMessage: "",
	reloadMessage: "",
};

type DiffRow = { line: number; before: string; after: string; kind: "added" | "removed" | "changed" };

type EditorFindState = {
	open: boolean;
	query: string;
	total: number;
	current: number;
};

const INITIAL_EDITOR_FIND: EditorFindState = {
	open: false,
	query: "",
	total: 0,
	current: 0,
};

function countMatches(text: string, query: string): number {
	if (!query) return 0;
	let count = 0;
	let idx = text.indexOf(query);
	while (idx !== -1) {
		count += 1;
		idx = text.indexOf(query, idx + query.length);
	}
	return count;
}

const LANG_MAP: Record<string, string> = {
	js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
	mjs: "javascript", cjs: "javascript",
	py: "python", pyw: "python",
	json: "json", jsonl: "json",
	yml: "yaml", yaml: "yaml",
	toml: "toml", ini: "toml", cfg: "toml", conf: "toml",
	sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
	html: "html", htm: "html", xml: "xml", xsl: "xml", xslt: "xml", svg: "xml",
	css: "css", scss: "css", sass: "css", less: "css",
	sql: "sql",
	go: "go", rs: "rust", java: "java", kt: "kotlin",
	c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
	rb: "ruby", php: "php", lua: "lua",
	dockerfile: "dockerfile", makefile: "makefile",
	env: "env", gitignore: "env",
	log: "log",
};

const TAB_INDENT = "	";

function getLangFromName(name?: string): string {
	if (!name) return "text";
	const lower = name.toLowerCase();
	if (lower === "dockerfile" || lower === "makefile" || lower === "vagrantfile" || lower === "gemfile") return LANG_MAP[lower] ?? "text";
	const ext = lower.split(".").pop() ?? "";
	return LANG_MAP[ext] ?? "text";
}

function buildLineDiff(before: string, after: string): DiffRow[] {
	const beforeLines = before.split("\n");
	const afterLines = after.split("\n");
	const max = Math.max(beforeLines.length, afterLines.length);
	const rows: DiffRow[] = [];
	for (let i = 0; i < max; i += 1) {
		const previous = beforeLines[i];
		const next = afterLines[i];
		if (previous === next) continue;
		rows.push({
			line: i + 1,
			before: previous ?? "",
			after: next ?? "",
			kind: previous == null ? "added" : next == null ? "removed" : "changed",
		});
	}
	return rows;
}

/* Simple token-based syntax highlighting using regex.
   Strategy: extract comments/strings first as placeholders, highlight keywords, then restore. */


function highlightLine(line: string, lang: string): string {
	if (lang === "text" || lang === "log") return escapeHtml(line);
	if (lang === "json") return highlightJson(line);
	
	let escaped = escapeHtml(line);
	
	const rules = getRules(lang);
	for (const rule of rules) {
		escaped = escaped.replace(rule.regex, rule.replace);
	}
	return escaped;
}

function getRules(lang: string): { regex: RegExp; replace: string }[] {
	const commentRule = (prefix: string) => ({
		regex: new RegExp(`(${escapeRegex(escapeHtml(prefix))}.*)$`),
		replace: '<span class="text-[var(--text-muted)] italic">$1</span>',
	});
	
	const jsKeywords = "break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|async|await|interface|type|enum|implements|declare|namespace|module|as|readonly|abstract|override|private|protected|public";
	const pyKeywords = "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None";
	const shellKeywords = "if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|export|source|local|readonly|set|unset|echo|cd|mkdir|rm|cp|mv|cat|grep|sed|awk|find|chmod|chown|sudo|apt|yum|npm|pip|git|docker|systemctl";
	
	const kw = (words: string) => ({
		regex: new RegExp(`\\b(${words})\\b`, "g"),
		replace: '<span class="text-blue-400 font-medium">$1</span>',
	});
	
	const strRule = {
		regex: /(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|`[^`]*?`)/g,
		replace: '<span class="text-emerald-400">$1</span>',
	};
	
	const numRule = {
		regex: /\b(\d+\.?\d*)\b/g,
		replace: '<span class="text-amber-400">$1</span>',
	};
	
	const decoratorRule = {
		regex: /(@\w+)/g,
		replace: '<span class="text-purple-400">$1</span>',
	};
	
	const common: { regex: RegExp; replace: string }[] = [strRule, numRule];
	
	switch (lang) {
		case "javascript":
		case "typescript":
			return [commentRule("//"), kw(jsKeywords), decoratorRule, ...common];
		case "python":
			return [commentRule("#"), kw(pyKeywords), decoratorRule, ...common];
		case "shell":
			return [commentRule("#"), kw(shellKeywords), ...common];
		case "yaml":
		case "toml":
			return [
				commentRule("#"),
				{ regex: /^(\s*[\w.-]+)(\s*[:=]\s*)/gm, replace: '<span class="text-cyan-400">$1</span>$2' },
				...common,
			];
		case "env":
			return [
				commentRule("#"),
				{ regex: /^(\s*[\w.-]+)(=)/gm, replace: '<span class="text-cyan-400">$1</span><span class="text-[var(--text-muted)]">=</span>' },
				...common,
			];
		case "html":
		case "xml":
			return [
				commentRule("<!--"),
				{ regex: /(&lt;\/?[\w.-]+)/g, replace: '<span class="text-blue-400">$1</span>' },
				{ regex: /(\s[\w.-]+)(=)/g, replace: '<span class="text-cyan-300">$1</span><span class="text-[var(--text-muted)]">=</span>' },
				strRule,
			];
		case "css":
			return [
				commentRule("/*"),
				{ regex: /([.#]?[\w-]+)\s*\{/g, replace: '<span class="text-cyan-300">$1</span> {' },
				{ regex: /([\w-]+)(\s*:)/g, replace: '<span class="text-[var(--text-primary)]">$1</span>$2' },
				strRule,
			];
		case "sql":
			return [
				commentRule("--"),
				kw("SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|IS|NULL|LIKE|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|AS|DISTINCT|COUNT|SUM|AVG|MAX|MIN|UNION|ALL|EXISTS|BETWEEN|CASE|WHEN|THEN|ELSE|END|ASC|DESC|PRIMARY|KEY|FOREIGN|REFERENCES|CONSTRAINT|DEFAULT|AUTO_INCREMENT|IF|BEGIN|COMMIT|ROLLBACK|TRANSACTION|VIEW|PROCEDURE|FUNCTION|TRIGGER|GRANT|REVOKE|DATABASE|SCHEMA"),
				...common,
			];
		case "go":
			return [
				commentRule("//"),
				kw("break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|nil|true|false|iota|append|cap|close|copy|delete|len|make|new|panic|print|println|recover"),
				...common,
			];
		case "rust":
			return [
				commentRule("//"),
				kw("as|async|await|break|const|continue|crate|dyn|else|enum|extern|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|type|unsafe|use|where|while|yield|true|false|Some|None|Ok|Err"),
				...common,
			];
		case "ruby":
			return [
				commentRule("#"),
				kw("alias|and|begin|break|case|class|def|defined|do|else|elsif|end|ensure|for|if|in|module|next|nil|not|or|redo|rescue|retry|return|self|super|then|undef|unless|until|when|while|yield|true|false|require|include|attr|raise|puts"),
				decoratorRule,
				...common,
			];
		case "php":
			return [
				commentRule("//"),
				kw("abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|die|do|echo|else|elseif|empty|endfor|endforeach|endif|endswitch|endwhile|eval|exit|extends|final|finally|for|foreach|function|global|goto|if|implements|include|instanceof|insteadof|interface|isset|list|namespace|new|or|print|private|protected|public|require|return|static|switch|throw|trait|try|unset|use|var|while|xor|yield|true|false|null"),
				{ regex: /(\$\w+)/g, replace: '<span class="text-purple-300">$1</span>' },
				...common,
			];
		default:
			return common;
	}
}

function highlightJson(line: string): string {
	let escaped = escapeHtml(line);
	// keys
	escaped = escaped.replace(/^\s*(&quot;[^&]+?&quot;)\s*(:)/, '<span class="text-cyan-400">$1</span><span class="text-[var(--text-muted)]">:</span>');
	// string values
	escaped = escaped.replace(/:\s*(&quot;[^&]*?&quot;)([,\s}]*)$/, ': <span class="text-emerald-400">$1</span>$2');
	// standalone strings in arrays
	escaped = escaped.replace(/^\s*(&quot;[^&]*?&quot;)([,\s\]]*)$/, '<span class="text-emerald-400">$1</span>$2');
	// numbers
	escaped = escaped.replace(/:\s*(\d+\.?\d*)([,\s}]*)$/, ': <span class="text-amber-400">$1</span>$2');
	// booleans & null
	escaped = escaped.replace(/:\s*(true|false|null)([,\s}]*)$/, ': <span class="text-blue-400">$1</span>$2');
	return escaped;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LANG_LABELS: Record<string, string> = {
	javascript: "JavaScript", typescript: "TypeScript", python: "Python", json: "JSON",
	yaml: "YAML", toml: "TOML/INI", shell: "Shell", html: "HTML", xml: "XML",
	css: "CSS", sql: "SQL", go: "Go", rust: "Rust", ruby: "Ruby", php: "PHP",
	c: "C", cpp: "C++", java: "Java", kotlin: "Kotlin", lua: "Lua",
};

function langLabel(t: (k: string) => string, lang: string): string {
	const translated = t(`textPreview.type.${lang}`);
	return translated === `textPreview.type.${lang}` ? (LANG_LABELS[lang] ?? lang) : translated;
}

type EditableDraft = {
	content: string;
	byteSize: number;
	lastModifiedMs?: number | null;
	updatedAt?: string | null;
};

type SaveResponse = {
	success: boolean;
	file: {
		byteSize: number;
		previousByteSize?: number;
		lastModifiedMs?: number | null;
		updatedAt?: string | null;
	};
};

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
			el.classList.add("bg-amber-400/10");
			setTimeout(() => el.classList.remove("bg-amber-400/10"), 2000);
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
			<div className="flex flex-col items-center gap-3 py-16 text-rose-300">
				<span className="text-3xl">⚠️</span>
				<p className="text-sm">{state.error}</p>
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
			return html.replace(new RegExp(`(${escaped})`, "gi"), '<mark class="bg-amber-400/30 text-amber-200 rounded-lg px-0.5">$1</mark>');
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
					<span data-tone="emerald" className="rounded-full border border-emerald-400/30 px-3 py-1 text-xs text-emerald-200">
						{t("textPreview.editHint")}
					</span>
				) : null}
				{saveMessage ? (
					<span
						role={saveStatus === "error" ? "alert" : "status"}
						className={`text-xs ${saveStatus === "error" ? "text-rose-300" : "text-emerald-300"}`}
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
									data-tone="emerald" className="rounded-lg border border-emerald-400/30 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
								>
									{saveStatus === "saving" ? t("textPreview.button.saving") : t("textPreview.button.previewSave")}
								</button>
								{canReloadAfterSave ? (
									<button
										type="button"
										onClick={handleSaveAndReload}
										disabled={saveStatus === "saving" || saveStatus === "reloading" || !hasUnsavedChanges}
										data-tone="amber" className="rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-400/20 disabled:opacity-50"
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
									className="rounded-lg border border-slate-700 bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-slate-700 light:hover:bg-slate-200 disabled:opacity-50"
								>
									{t("textPreview.button.cancel")}
								</button>
								<button
									type="button"
									onClick={() => setEditorFind({ open: true, query: "", total: 0, current: 0 })}
									aria-label={t("textPreview.editor.findToggle")}
									title={t("textPreview.editor.findToggle")}
									className="rounded-lg border border-slate-700 bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-slate-700 light:hover:bg-slate-200"
								>
									🔍
								</button>
								</>
						) : (
							<button
								type="button"
								onClick={() => setEditMode(true)}
								data-tone="cyan" className="rounded-lg border border-cyan-400/30 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-cyan-400/20"
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
				<div role="dialog" aria-modal="true" aria-label={t("textPreview.diffDialog.title")} data-tone="amber" className="rounded-2xl border border-amber-400/20 p-4 shadow-2xl shadow-black/20">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h3 className="text-sm font-semibold text-amber-100">{t("textPreview.diffDialog.title")}</h3>
							<p className="mt-1 text-xs text-amber-100/80">
								{t("textPreview.diffDialog.summary").replace("{added}", String(diffSummary.added)).replace("{removed}", String(diffSummary.removed)).replace("{changed}", String(diffSummary.changed))}
							</p>
							<p className="mt-1 text-xs text-amber-100/70">
								{t("textPreview.diffDialog.note")}
							</p>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setShowDiffReview(false)}
								disabled={saveStatus === "saving" || saveStatus === "reloading"}
								className="rounded-lg border border-slate-600/60 bg-[var(--surface)]/70 px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-50"
							>
								{t("textPreview.button.backToEdit")}
							</button>
							<button
								type="button"
								onClick={handleSave}
								disabled={saveStatus === "saving" || saveStatus === "reloading" || diffRows.length === 0}
								data-tone="emerald" className="rounded-lg border border-emerald-300/40 px-3 py-1.5 text-xs font-medium text-emerald-100 disabled:opacity-50"
							>
								{saveStatus === "saving" ? t("textPreview.button.saving") : t("textPreview.button.confirmSave")}
							</button>
							{canReloadAfterSave ? (
								<button
									type="button"
									onClick={handleSaveAndReload}
									disabled={saveStatus === "saving" || saveStatus === "reloading" || diffRows.length === 0}
									data-tone="amber" className="rounded-lg border border-amber-300/40 px-3 py-1.5 text-xs font-medium text-amber-100 disabled:opacity-50"
									title={reloadKind === "systemd"
										? t("textPreview.reloadHint.systemdConfirm").replace("{unit}", reloadUnit ?? "")
										: t("textPreview.reloadHint.dockerConfirm").replace("{unit}", reloadUnit ?? "")}
								>
									{saveStatus === "saving"
										? t("textPreview.button.saving")
										: saveStatus === "reloading"
											? t("textPreview.button.reloading")
											: t("textPreview.button.saveAndReload").replace("{unit}", reloadUnit ?? "")}
								</button>
							) : null}
						</div>
					</div>
					<div className="mt-3 max-h-72 overflow-auto rounded-xl border border-[var(--border)]/[0.10] bg-[var(--surface)]">
						{diffRows.length === 0 ? (
							<p className="px-3 py-2 text-xs text-[var(--text-secondary)]">{t("textPreview.diffEmpty")}</p>
						) : (
							<ul className="divide-y divide-white/[0.10] light:divide-slate-200">
								{diffRows.slice(0, 80).map((row) => (
									<li key={`${row.line}-${row.kind}`} className="grid gap-1 px-3 py-2 text-xs md:grid-cols-[80px_1fr_1fr]">
										<span className="font-mono text-[var(--text-muted)]">L{row.line} · {row.kind === "added" ? t("textPreview.diffKind.added") : row.kind === "removed" ? t("textPreview.diffKind.removed") : t("textPreview.diffKind.changed")}</span>
										<code className="min-h-5 whitespace-pre-wrap break-all rounded-lg bg-rose-500/10 px-2 py-1 text-rose-200">- {row.before}</code>
										<code className="min-h-5 whitespace-pre-wrap break-all rounded-lg bg-emerald-500/10 px-2 py-1 text-emerald-200">+ {row.after}</code>
									</li>
								))}
								{diffRows.length > 80 ? <li className="px-3 py-2 text-xs text-[var(--text-muted)]">{t("textPreview.diffMore").replace("{count}", String(diffRows.length - 80))}</li> : null}
							</ul>
						)}
					</div>
				</div>
			) : null}

			{editMode ? (
				<div className="space-y-2">
					{editorFind.open ? (
						<div
							role="search"
							aria-label={t("textPreview.editor.findToggle")}
							data-testid="editor-find-bar"
							className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-[var(--surface)]/70 px-3 py-2"
						>
							<input
								ref={editorFindInputRef}
								type="text"
								value={editorFind.query}
								onChange={(event) => updateEditorFindQuery(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										moveEditorFind(event.shiftKey ? -1 : 1);
									}
								}}
								placeholder={t("textPreview.editor.findPlaceholder")}
								aria-label={t("textPreview.editor.findPlaceholder")}
								className="w-48 rounded-lg border border-slate-700 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] placeholder:text-[var(--text-muted)] focus:border-amber-300 focus:outline-none"
							/>
							<span className="text-xs text-[var(--text-secondary)]" data-testid="editor-find-count">
								{editorFind.query === ""
									? ""
									: editorFind.total === 0
										? t("textPreview.editor.findNoMatch")
										: t("textPreview.editor.findMatchCount")
											.replace("{current}", String(editorFind.current))
											.replace("{total}", String(editorFind.total))}
							</span>
							<div className="flex-1" />
							<button
								type="button"
								onClick={() => moveEditorFind(-1)}
								disabled={editorFind.total === 0}
								aria-label={t("textPreview.editor.findPrev")}
								title={t("textPreview.editor.findPrev")}
								className="rounded-lg border border-slate-700 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-slate-700 disabled:opacity-40"
							>
								↑
							</button>
							<button
								type="button"
								onClick={() => moveEditorFind(1)}
								disabled={editorFind.total === 0}
								aria-label={t("textPreview.editor.findNext")}
								title={t("textPreview.editor.findNext")}
								className="rounded-lg border border-slate-700 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-slate-700 disabled:opacity-40"
							>
								↓
							</button>
							<button
								type="button"
								onClick={closeEditorFind}
								aria-label={t("textPreview.editor.findClose")}
								title={t("textPreview.editor.findClose")}
								className="rounded-lg border border-slate-700 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-slate-700"
							>
								✕
							</button>
						</div>
					) : null}
					<div
						title={t("textPreview.editor.indentHint")}
						className="flex min-h-[70vh] overflow-hidden rounded-2xl border border-cyan-400/30 bg-[var(--surface)] font-mono text-sm leading-relaxed text-[var(--text-primary)] focus-within:border-cyan-300"
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
								html = sanitizeHighlightHtml(html);
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
