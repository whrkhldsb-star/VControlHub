"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ActionButton } from "@/components/action-button";
import { Badge, Notice } from "@/components/ui-primitives";
import { useSessionGate } from "@/lib/auth/session-context";
import { api } from "@/lib/http/api-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { STARTER_SNIPPETS } from "@/lib/snippet/starters";
import { extractSnippetVariables, insertSnippetAtSelection, MAX_COMMAND_BODY_LENGTH, substituteSnippetVariables } from "@/lib/snippet/variables";
import { UI_INPUT } from "@/lib/ui/classes";
import { isImeComposition } from "@/lib/ui/keyboard";

type InsertMode = "insert" | "replace";
export type SnippetPickerMode = "immediate" | "template";
export interface SnippetPickerProps {
	mode: SnippetPickerMode;
	onInsert: (text: string, mode: InsertMode) => void | boolean;
	canReadSavedSnippets?: boolean;
	osHint?: "LINUX" | "WINDOWS";
	disabled?: boolean;
}

/** All editors validate the resulting buffer and restore the cursor after React commits. */
export function EditorSnippetPicker({ editor, onChange, ...props }: Omit<SnippetPickerProps, "onInsert"> & {
	editor: RefObject<HTMLTextAreaElement | null>; onChange: (value: string) => void;
}) {
	return <SnippetPicker {...props} onInsert={(text, mode) => {
		const field = editor.current;
		if (!field || field.readOnly || field.disabled) return false;
		const result = insertSnippetAtSelection({ currentValue: field.value, snippetText: text,
			selectionStart: mode === "replace" ? 0 : field.selectionStart,
			selectionEnd: mode === "replace" ? field.value.length : field.selectionEnd });
		if (!result.ok) return false;
		onChange(result.nextValue);
		requestAnimationFrame(() => { field.focus(); field.setSelectionRange(result.nextCursor, result.nextCursor); });
		return true;
	}} />;
}

type Row = { id: string; title: string; language: string; tags: string[]; description?: string | null; content?: string; contentPreview?: string };
export function SnippetPicker({ mode, onInsert, canReadSavedSnippets, osHint, disabled }: SnippetPickerProps) {
	const { t } = useI18n();
	const gate = useSessionGate();
	const allowSavedSnippets = canReadSavedSnippets ?? (gate.authenticated ? gate.permissions.includes("snippet:manage") : true);
	const id = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const sequence = useRef(0);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [language, setLanguage] = useState("");
	const [category, setCategory] = useState("");
	const [active, setActive] = useState(0);
	const [saved, setSaved] = useState<{ query: string; rows: Row[] } | null>(null);
	const [allSaved, setAllSaved] = useState<Row[]>([]);
	const [choice, setChoice] = useState<Row | null>(null);
	const [values, setValues] = useState<Record<string, string>>({});
	const [insertMode, setInsertMode] = useState<InsertMode>("insert");
	const [error, setError] = useState("");
	const search = query.trim();
	useEffect(() => () => { sequence.current++; }, [allowSavedSnippets, disabled]);
	useEffect(() => {
		if (!open || disabled || !allowSavedSnippets) return;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const { snippets } = await api.get<{ snippets: Row[] }>(search ? `/api/snippets?q=${encodeURIComponent(search)}` : "/api/snippets", { signal: controller.signal });
				if (!controller.signal.aborted) { setSaved({ query: search, rows: snippets }); if (!search) setAllSaved(snippets); }
			} catch (cause) {
				if (controller.signal.aborted) return;
				setSaved({ query: search, rows: [] });
				if ((cause as { status?: number })?.status === 403) setAllSaved([]); else setError("snippetsPage.toast.loadFailed");
			}
		}, search ? 200 : 0);
		return () => { clearTimeout(timer); controller.abort(); };
	}, [open, allowSavedSnippets, disabled, search]);
	const starters = STARTER_SNIPPETS.map(s => ({ ...s, title: t(s.titleKey), description: t(s.descriptionKey) }));
	const savedRows = allowSavedSnippets ? [...new Map([...allSaved, ...(saved?.rows ?? [])].map(s => [s.id, s])).values()] : [];
	const serverMatches = new Set(saved?.query === search ? saved.rows.map(row => row.id) : []);
	const matches = (s: Row) => [s.title, s.language, s.description, ...s.tags, s.content ?? s.contentPreview].join(" ").toLowerCase().includes(search.toLowerCase());
	const rows: Row[] = [...starters.filter(matches), ...savedRows.filter(s => serverMatches.has(s.id) || matches(s))]
		.filter(s => (!language || s.language === language) && (!category || s.tags.includes(category)));
	const index = Math.min(active, rows.length - 1);
	function close() { sequence.current++; setOpen(false); trigger.current?.focus(); }
	function insert(text: string) {
		if (text.length > MAX_COMMAND_BODY_LENGTH || onInsert(text, insertMode) === false) { setError("snippetsPage.picker.tooLong"); return; }
		close();
	}
	// Docker Go templates use {{.Field}}; these are command syntax, not user inputs.
	const variablesFor = (text: string) => extractSnippetVariables(text).filter(name => !name.startsWith("."));
	async function select(row: Row) {
		const ticket = ++sequence.current;
		setError("");
		try {
			const content = row.content ?? (await api.get<{ snippet: { content: string } }>(`/api/snippets?id=${encodeURIComponent(row.id)}`)).snippet.content;
			if (ticket !== sequence.current) return;
			if (mode === "immediate" && variablesFor(content).length) { setValues({}); setChoice({ ...row, content }); }
			else insert(content);
		} catch { if (ticket === sequence.current) setError("snippetsPage.toast.loadFailed"); }
	}
	return <div className="space-y-2" onKeyDown={e => {
		if (open && e.key === "Escape" && !isImeComposition(e)) { e.preventDefault(); e.stopPropagation(); close(); }
	}}>
		<button type="button" ref={trigger} data-action-button data-variant="secondary" data-size="sm" disabled={disabled} aria-expanded={open} aria-controls={id}
			onClick={() => { if (open) return close(); setOpen(true); setChoice(null); setError(""); setQuery(""); setActive(0); setSaved(null); setAllSaved([]); setCategory(""); setInsertMode("insert"); setLanguage(osHint === "LINUX" ? "bash" : osHint === "WINDOWS" ? "powershell" : ""); }}>
			{t("snippetsPage.picker.open")}
		</button>
		{open && !disabled && <div id={id} data-inset className="space-y-3 p-3">
			<label className="ui-label grid gap-1">{t("snippetsPage.picker.action")}<select className={UI_INPUT} value={insertMode} onChange={e => setInsertMode(e.target.value as InsertMode)}>
				<option value="insert">{t("snippetsPage.picker.insert")}</option><option value="replace">{t("snippetsPage.picker.replace")}</option></select></label>
			{choice ? <div className="space-y-2"><strong>{choice.title}</strong><pre className="overflow-auto whitespace-pre-wrap">{choice.content}</pre>
				{variablesFor(choice.content!).map((name, i) => <label key={name} className="ui-label grid gap-1">{name}<input autoFocus={i === 0} className={UI_INPUT} value={Object.hasOwn(values, name) ? values[name] : ""} onChange={e => setValues({ ...values, [name]: e.target.value })} onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} /></label>)}
				<ActionButton disabled={!variablesFor(choice.content!).every(name => Object.hasOwn(values, name) && values[name]?.trim())} onClick={() => insert(substituteSnippetVariables(choice.content!, values))}>{t("snippetsPage.picker.apply")}</ActionButton>
				<ActionButton variant="secondary" onClick={() => { setChoice(null); setError(""); }}>{t("common.cancel")}</ActionButton></div> : <>
				<input autoFocus type="search" maxLength={120} role="combobox" aria-label={t("snippetsPage.search")} aria-expanded aria-controls={`${id}-list`} aria-activedescendant={index < 0 ? undefined : `${id}-${index}`} className={UI_INPUT} placeholder={t("snippetsPage.search")} value={query} onChange={e => { sequence.current++; setQuery(e.target.value); setActive(0); setError(""); }}
					onKeyDown={e => { if (isImeComposition(e)) return; if (["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) { e.preventDefault(); if (!rows.length) return; if (e.key === "Enter") void select(rows[index]!); else { const next = (index + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length; setActive(next); document.getElementById(`${id}-${next}`)?.scrollIntoView?.({ block: "nearest" }); } } }} />
				<div className="flex flex-wrap gap-2"><select className={UI_INPUT} aria-label={t("snippetsPage.filter.placeholder")} value={language} onChange={e => { setLanguage(e.target.value); setActive(0); }}>
					<option value="">{t("snippetsPage.filter.allLanguages")}</option>{[...new Set([...starters, ...savedRows].map(s => s.language))].map(l => <option key={l}>{l}</option>)}</select>
					<select className={UI_INPUT} aria-label={t("snippetsPage.picker.categories")} value={category} onChange={e => { setCategory(e.target.value); setActive(0); }}><option value="">{t("snippetsPage.picker.categories")}</option>{[...new Set([...starters, ...savedRows].flatMap(s => s.tags))].sort().map(tag => <option key={tag}>{tag}</option>)}</select></div>
				<div role="listbox" aria-label={t("snippetsPage.picker.open")} id={`${id}-list`} className="max-h-60 space-y-1 overflow-auto">{rows.map((row, i) => <button type="button" role="option" aria-selected={index === i} data-tile data-selected={index === i ? "" : undefined} id={`${id}-${i}`} key={row.id} onClick={() => void select(row)} className="block w-full p-2 text-left text-sm"><strong>{row.title}</strong> <Badge>{row.language}</Badge><code className="block truncate text-xs">{row.content ?? row.contentPreview}</code></button>)}</div>
				{!rows.length && <p>{t("snippetsPage.noMatch")}</p>}
			</>}
			{error && <Notice tone="danger">{t(error)}</Notice>}
		</div>}
	</div>;
}
