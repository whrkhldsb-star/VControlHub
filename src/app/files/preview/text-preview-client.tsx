"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from "react";
import createDOMPurify from "dompurify";
import type { Config } from "dompurify";

import { csrfFetch } from "@/lib/auth/csrf-client";

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
	saveStatus: "idle" | "saving" | "saved" | "error";
	saveMessage: string;
};

const INITIAL_PREVIEW_META: PreviewMetaState = {
	editMode: false,
	showDiffReview: false,
	saveStatus: "idle",
	saveMessage: "",
};

type DiffRow = { line: number; before: string; after: string; kind: "added" | "removed" | "changed" };

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
		replace: '<span class="text-slate-500 italic">$1</span>',
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
				{ regex: /^(\s*[\w.-]+)(=)/gm, replace: '<span class="text-cyan-400">$1</span><span class="text-slate-500">=</span>' },
				...common,
			];
		case "html":
		case "xml":
			return [
				commentRule("<!--"),
				{ regex: /(&lt;\/?[\w.-]+)/g, replace: '<span class="text-blue-400">$1</span>' },
				{ regex: /(\s[\w.-]+)(=)/g, replace: '<span class="text-cyan-300">$1</span><span class="text-slate-500">=</span>' },
				strRule,
			];
		case "css":
			return [
				commentRule("/*"),
				{ regex: /([.#]?[\w-]+)\s*\{/g, replace: '<span class="text-cyan-300">$1</span> {' },
				{ regex: /([\w-]+)(\s*:)/g, replace: '<span class="text-white">$1</span>$2' },
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
	escaped = escaped.replace(/^\s*(&quot;[^&]+?&quot;)\s*(:)/, '<span class="text-cyan-400">$1</span><span class="text-slate-500">:</span>');
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
	dockerfile: "Dockerfile", makefile: "Makefile", env: "Env", text: "文本", log: "日志",
};

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
}: {
	href: string;
	name?: string;
	fileEntryId?: string;
	editable?: boolean;
}) {
	const [state, setState] = useState<PreviewState>({ loading: true });
	const [loadVersion, resetForLoad] = useReducer((value: number) => value + 1, 0);
	const [searchQuery, setSearchQuery] = useState("");
	const [jumpLine, setJumpLine] = useState("");
	const [previewMeta, setPreviewMeta] = useState<PreviewMetaState>(INITIAL_PREVIEW_META);
	const [draft, setDraft] = useState("");
	const [draftVersion, setDraftVersion] = useState<{ updatedAt?: string | null; lastModifiedMs?: number | null }>({});
	const { editMode, showDiffReview, saveStatus, saveMessage } = previewMeta;
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
	const lineRef = useRef<Map<number, HTMLDivElement>>(new Map());
	const containerRef = useRef<HTMLDivElement>(null);
	const didMountRef = useRef(false);

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
					if (!res.ok) throw new Error(`加载失败: ${res.status}`);
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
						error: err instanceof Error ? err.message : "加载失败",
					});
				}
			}
		};

		load();
		return () => {
			cancelled = true;
		};
	}, [href, fileEntryId, canEdit, loadVersion]);

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

	const handleSave = useCallback(async () => {
		if (!fileEntryId) return;
		setSaveStatus("saving");
		setSaveMessage("");
		try {
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
			setSaveMessage(`已保存 ${response.file.byteSize} B`);
		} catch (err) {
			setSaveStatus("error");
			setSaveMessage(err instanceof Error ? err.message : "保存失败");
		}
	}, [draft, draftVersion.lastModifiedMs, draftVersion.updatedAt, fileEntryId, setEditMode, setSaveMessage, setSaveStatus, setShowDiffReview]);

	if (state.loading) {
		return (
			<div className="flex items-center justify-center py-16 text-slate-400 light:text-slate-600">
				<span className="animate-pulse text-sm">正在加载文件内容…</span>
			</div>
		);
	}

	if (state.error) {
		return (
			<div className="flex flex-col items-center gap-3 py-16 text-red-300">
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
			return html.replace(new RegExp(`(${escaped})`, "gi"), '<mark class="bg-amber-400/30 text-amber-200 rounded px-0.5">$1</mark>');
		} catch {
			return html;
		}
	};

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="rounded-full bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-300 border border-blue-400/30">
					{LANG_LABELS[lang] ?? lang.toUpperCase()}
				</span>
				<span className="text-xs text-slate-500">{totalLines} 行</span>
				{canEdit ? (
					<span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200 light:text-emerald-800">
						可在线编辑 · 保存会校验并发修改
					</span>
				) : null}
				{saveMessage ? (
					<span
						role={saveStatus === "error" ? "alert" : "status"}
						className={`text-xs ${saveStatus === "error" ? "text-rose-300" : "text-emerald-300"}`}
					>
						{saveMessage}
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
									disabled={saveStatus === "saving" || !hasUnsavedChanges}
									className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-100 light:text-emerald-900 hover:bg-emerald-400/20 disabled:opacity-50"
								>
									{saveStatus === "saving" ? "保存中…" : "预览并保存"}
								</button>
								<button
									type="button"
									onClick={() => {
										setDraft(currentContent);
										setEditMode(false);
										setShowDiffReview(false);
										setSaveStatus("idle");
										setSaveMessage("");
									}}
									disabled={saveStatus === "saving"}
									className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-800 light:bg-slate-100 px-3 py-1.5 text-xs text-slate-300 light:text-slate-700 hover:bg-slate-700 light:hover:bg-slate-200 disabled:opacity-50"
								>
									取消
								</button>
							</>
						) : (
							<button
								type="button"
								onClick={() => setEditMode(true)}
								className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-100 light:text-cyan-900 hover:bg-cyan-400/20"
							>
								编辑
							</button>
						)}
					</div>
				) : null}
				{!editMode ? (
					<>
						<div className="flex flex-col gap-1">
							<label htmlFor="text-preview-search" className="text-[11px] font-medium text-slate-400 light:text-slate-600">
								搜索文本
							</label>
							<input
								id="text-preview-search"
								type="text"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="输入关键词"
								className="w-36 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900 light:bg-white px-2 py-1 text-xs text-slate-300 light:text-slate-700 placeholder:text-slate-600 light:placeholder:text-slate-500 focus:border-cyan-500/50 focus:outline-none"
							/>
						</div>
						<div className="flex items-end gap-1">
							<div className="flex flex-col gap-1">
								<label htmlFor="text-preview-jump-line" className="text-[11px] font-medium text-slate-400 light:text-slate-600">
									跳转行号
								</label>
								<input
									id="text-preview-jump-line"
									type="text"
									inputMode="numeric"
									value={jumpLine}
									onChange={(e) => setJumpLine(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && handleJumpToLine()}
									placeholder="如 42"
									className="w-24 rounded-lg border border-slate-700 light:border-slate-200 bg-slate-900 light:bg-white px-2 py-1 text-xs text-slate-300 light:text-slate-700 placeholder:text-slate-600 light:placeholder:text-slate-500 focus:border-cyan-500/50 focus:outline-none"
								/>
							</div>
							<button
								type="button"
								onClick={handleJumpToLine}
								className="rounded-lg border border-slate-700 light:border-slate-200 bg-slate-800 light:bg-slate-100 px-2 py-1 text-xs text-slate-300 light:text-slate-700 hover:bg-slate-700 light:hover:bg-slate-200"
							>
								跳转
							</button>
						</div>
					</>
				) : null}
			</div>

			{editMode && showDiffReview ? (
				<div role="dialog" aria-modal="true" aria-label="保存前差异预览" className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4 shadow-2xl shadow-black/20">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h3 className="text-sm font-semibold text-amber-100 light:text-amber-900">保存前差异预览</h3>
							<p className="mt-1 text-xs text-amber-100/80 light:text-amber-900/80">
								请确认变更后再写入文件：新增 {diffSummary.added} 行，删除 {diffSummary.removed} 行，修改 {diffSummary.changed} 行。
							</p>
							<p className="mt-1 text-xs text-amber-100/70 light:text-amber-900/70">
								保存时会校验打开草稿后的文件时间戳；如果文件已被其它窗口或磁盘操作修改，将拒绝覆盖并提示重新加载。
							</p>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setShowDiffReview(false)}
								disabled={saveStatus === "saving"}
								className="rounded-lg border border-slate-600/60 bg-slate-900/40 px-3 py-1.5 text-xs text-slate-200 light:border-slate-300 light:bg-white/70 light:text-slate-700 disabled:opacity-50"
							>
								返回编辑
							</button>
							<button
								type="button"
								onClick={handleSave}
								disabled={saveStatus === "saving" || diffRows.length === 0}
								className="rounded-lg border border-emerald-300/40 bg-emerald-400/20 px-3 py-1.5 text-xs font-medium text-emerald-100 light:text-emerald-900 disabled:opacity-50"
							>
								{saveStatus === "saving" ? "保存中…" : "确认保存"}
							</button>
						</div>
					</div>
					<div className="mt-3 max-h-72 overflow-auto rounded-xl border border-white/[0.08] bg-slate-950/80 light:bg-white/80">
						{diffRows.length === 0 ? (
							<p className="px-3 py-2 text-xs text-slate-400">没有检测到内容差异。</p>
						) : (
							<ul className="divide-y divide-white/[0.06]">
								{diffRows.slice(0, 80).map((row) => (
									<li key={`${row.line}-${row.kind}`} className="grid gap-1 px-3 py-2 text-xs md:grid-cols-[80px_1fr_1fr]">
										<span className="font-mono text-slate-500">L{row.line} · {row.kind === "added" ? "新增" : row.kind === "removed" ? "删除" : "修改"}</span>
										<code className="min-h-5 whitespace-pre-wrap break-all rounded bg-rose-500/10 px-2 py-1 text-rose-200 light:text-rose-800">- {row.before}</code>
										<code className="min-h-5 whitespace-pre-wrap break-all rounded bg-emerald-500/10 px-2 py-1 text-emerald-200 light:text-emerald-800">+ {row.after}</code>
									</li>
								))}
								{diffRows.length > 80 ? <li className="px-3 py-2 text-xs text-slate-500">还有 {diffRows.length - 80} 行差异未展示，仍会一起保存。</li> : null}
							</ul>
						)}
					</div>
				</div>
			) : null}

			{editMode ? (
				<textarea
					aria-label="在线编辑文件内容"
					value={draft}
					onChange={(event) => {
						setDraft(event.currentTarget.value);
						setSaveStatus("idle");
						setSaveMessage("");
					}}
					onClick={() => showDiffReview && setShowDiffReview(false)}
					className="min-h-[70vh] w-full rounded-2xl border border-cyan-400/30 bg-slate-950 light:bg-white p-4 font-mono text-sm leading-relaxed text-slate-100 outline-none focus:border-cyan-300"
					spellCheck={false}
				/>
			) : (
				<div ref={containerRef} className="overflow-auto rounded-2xl bg-slate-950 light:bg-white p-4 text-sm leading-relaxed max-h-[75vh]">
					<pre className="font-mono text-slate-300 light:text-slate-700">
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
										<span className="mr-4 inline-block w-12 select-none text-right text-slate-600 shrink-0">
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
