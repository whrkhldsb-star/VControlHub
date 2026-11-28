"use client";

import { useState } from "react";
import { ActionButton, ButtonLink } from "@/components/action-button";
import { SegmentedTabs, Notice } from "@/components/ui-primitives";
import { api } from "@/lib/http/api-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { STARTER_SNIPPETS, type StarterSnippet } from "@/lib/snippet/starters";
import { directCommandHref } from "@/lib/ui/deep-links";
import type { SnippetFormValue } from "./snippet-modal";

export function StarterShelf({ canRun, canManage, onSaved }: { canRun: boolean; canManage: boolean; onSaved: (row: SnippetFormValue) => void }) {
	const { t } = useI18n();
	const [language, setLanguage] = useState("bash");
	const [busy, setBusy] = useState<string | null>(null);
	const [saved, setSaved] = useState<string[]>([]);
	const [failed, setFailed] = useState(false);
	async function save(s: StarterSnippet) {
		setBusy(s.id); setFailed(false);
		try {
			const { snippet } = await api.post<{ snippet: SnippetFormValue }>("/api/snippets", { title: t(s.titleKey), description: t(s.descriptionKey),
				language: s.language, content: s.content, tags: s.tags, isPrivate: true });
			onSaved(snippet); setSaved(ids => [...ids, s.id]);
		} catch { setFailed(true); } finally { setBusy(null); }
	}
	return <section data-card className="mb-5 space-y-3 p-4"><h2 className="ui-title-section">{t("snippetsPage.starters")}</h2>
		<SegmentedTabs ariaLabel={t("snippetsPage.starters")} value={language} onChange={setLanguage} items={[{ id: "bash", label: "Linux" }, { id: "powershell", label: "PowerShell" }]} />
		{failed && <Notice tone="danger">{t("snippetsPage.toast.saveFailed")}</Notice>}
		<div className="grid gap-3 md:grid-cols-2">{STARTER_SNIPPETS.filter(s => s.language === language).map(s => <article data-inset key={s.id} className="min-w-0 space-y-2 p-3">
			<h3 className="ui-title-group">{t(s.titleKey)}</h3><p className="text-sm text-[var(--text-muted)]">{t(s.descriptionKey)}</p>
			<code className="block max-h-20 overflow-auto whitespace-pre-wrap break-all text-xs">{s.content}</code><div className="flex flex-wrap gap-2">
				{canManage && <ActionButton size="sm" variant="secondary" disabled={!!busy || saved.includes(s.id)} onClick={() => void save(s)}>{t(saved.includes(s.id) ? "snippetsPage.toast.saved" : "snippetsPage.saveStarter")}</ActionButton>}
				{canRun && <ButtonLink size="sm" href={directCommandHref({ snippetId: s.id })}>{t("snippetsPage.run")}</ButtonLink>}</div></article>)}</div>
	</section>;
}
