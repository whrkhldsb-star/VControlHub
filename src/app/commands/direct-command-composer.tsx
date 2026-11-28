"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActionButton, ButtonLink } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EditorSnippetPicker } from "@/components/snippet-picker";
import { Badge, Notice } from "@/components/ui-primitives";
import { api } from "@/lib/http/api-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { MAX_COMMAND_BODY_LENGTH, extractSnippetVariables, substituteSnippetVariables } from "@/lib/snippet/variables";
import { UI_INPUT } from "@/lib/ui/classes";
import { commandRequestHref } from "@/lib/ui/deep-links";
import { randomId } from "@/lib/ui/random-id";
import { ServerTargetPicker, type ServerTarget } from "@/app/servers/server-target-picker";

export type CommandTargetOption = { id: string; name: string; host: string; operatingSystem?: "LINUX" | "WINDOWS"; available?: boolean; unavailableReason?: string };
export type CommandDraft = { command?: string; title?: string; reason?: string; serverIds?: string[]; fromSnippet?: boolean };
export type ComposerProps = {
	servers: CommandTargetOption[]; allowDirectExecution: boolean; remoteTargets?: boolean; canReadRequests?: boolean;
	canReadTasks?: boolean; canReadSavedSnippets?: boolean; initial?: CommandDraft;
};
type Preview = { riskLevel: string; riskReasons: string[]; denylisted: boolean; requiresApproval: boolean };
type Receipt = { id: string; status: string; riskLevel: string; targets: unknown[]; requiresApproval: boolean };
type Template = { name: string; description?: string; command: string };

export function DirectCommandComposer({ servers, allowDirectExecution, remoteTargets, canReadRequests, canReadTasks, canReadSavedSnippets, initial }: ComposerProps) {
	const { t } = useI18n();
	const riskLabel = (level: string) => t(`aiPage.risk.${level.toLowerCase()}`);
	const riskReason = (reason: string) => {
		const key = `commandsPage.riskReason.${reason}`;
		const label = t(key);
		return label === key ? reason : label;
	};
	const editor = useRef<HTMLTextAreaElement>(null);
	const [command, setCommand] = useState(initial?.command ?? "");
	const [title, setTitle] = useState(initial?.title ?? "");
	const [reason, setReason] = useState(initial?.reason ?? "");
	const [variables, setVariables] = useState<Record<string, string>>({});
	const names = initial?.fromSnippet ? extractSnippetVariables(command).filter(n => !n.startsWith(".")) : [];
	const complete = names.every(n => Object.hasOwn(variables, n) && variables[n]?.trim());
	const body = (names.length ? substituteSnippetVariables(command, variables) : command).trim();
	const [peer, setPeer] = useState(false);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(() => servers.filter(s => s.available !== false && initial?.serverIds?.includes(s.id)).map(s => s.id));
	const [remote, setRemote] = useState<ServerTarget[]>([]);
	const options = remoteTargets ? remote : servers;
	const targets = options.filter(s => selected.includes(s.id));
	const available = servers.filter(s => s.available !== false);
	const visible = servers.filter(s => `${s.name} ${s.host} ${s.operatingSystem ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
	const [save, setSave] = useState(false);
	const [templateName, setTemplateName] = useState("");
	const [description, setDescription] = useState("");
	const [templateFailed, setTemplateFailed] = useState<Template | null>(null);
	const [templateSaved, setTemplateSaved] = useState(false);
	const [saving, setSaving] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [receipt, setReceipt] = useState<Receipt | null>(null);
	const [error, setError] = useState("");
	const [confirm, setConfirm] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const key = useRef<{ fingerprint: string; id: string } | null>(null);
	const previewPayload = useMemo(() => ({ command: body, serverIds: selected, ...(!allowDirectExecution || peer ? { approvalRequired: true } : {}) }), [body, selected, allowDirectExecution, peer]);
	const [assessment, setAssessment] = useState<{ payload: typeof previewPayload; data?: Preview; failed?: boolean } | null>(null);
	const validBody = !!body && complete && body.length <= MAX_COMMAND_BODY_LENGTH;
	const withinTargetLimit = selected.length <= 500;
	useEffect(() => {
		if (!validBody || !withinTargetLimit || receipt) return;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const { preview } = await api.post<{ preview: Preview }>("/api/commands/preview", previewPayload, { signal: controller.signal });
				if (!controller.signal.aborted) setAssessment({ payload: previewPayload, data: preview });
			} catch { if (!controller.signal.aborted) setAssessment({ payload: previewPayload, failed: true }); }
		}, 300);
		return () => { clearTimeout(timer); controller.abort(); };
	}, [previewPayload, validBody, withinTargetLimit, receipt, attempt]);
	const preview = assessment?.payload === previewPayload ? assessment.data : undefined;
	const requiresReview = !allowDirectExecution || peer || preview?.requiresApproval;
	const elevated = preview && (preview.denylisted || ["high", "critical"].includes(preview.riskLevel));
	const ready = validBody && selected.length > 0 && !!preview && (!save || !!templateName.trim()) && !submitting && !receipt;
	async function persistTemplate(snapshot: Template) {
		setSaving(true); setTemplateFailed(null);
		try { await api.post("/api/command-templates", snapshot); setTemplateSaved(true); }
		catch { setTemplateFailed(snapshot); }
		finally { setSaving(false); }
	}
	async function dispatch() {
		if (!ready) return;
		setSubmitting(true); setError("");
		const payload = { ...previewPayload, title: title.trim() || body.split(/\r?\n/, 1)[0]!.slice(0, 120), reason: reason.trim() || undefined, submissionMode: "user" };
		const fingerprint = JSON.stringify(payload);
		if (key.current?.fingerprint !== fingerprint) key.current = { fingerprint, id: `command-ui:${randomId()}` };
		try {
			const result = await api.post<{ command: Receipt }>("/api/commands", { ...payload, idempotencyKey: key.current.id });
			setReceipt(result.command); setConfirm(false);
			if (save) await persistTemplate({ name: templateName.trim(), description: description.trim() || undefined, command: body });
		} catch (cause) { setError(getErrorMessage(cause, t("serversPage.command.failed"))); }
		finally { setSubmitting(false); }
	}
	if (receipt) return <section data-card className="space-y-3 p-5" aria-live="polite">
		<h2 className="ui-title-section">{t("commandsPage.receipt")}</h2>
		<p>{t(receipt.status === "PENDING_APPROVAL" ? "serversPage.command.approvalSuccess" : "serversPage.command.success")}</p>
		<p><Badge>{receipt.status}</Badge> {receipt.riskLevel && <Badge>{riskLabel(receipt.riskLevel)}</Badge>} {t("commandsPage.targetCount", { count: receipt.targets.length })}</p>
		<div className="flex flex-wrap gap-2">{canReadRequests && <ButtonLink href={commandRequestHref(receipt.id)}>{t("commandsPage.openRequest")}</ButtonLink>}
			{canReadTasks && <ButtonLink variant="secondary" href="/operation-tasks">{t("commandsPage.openTasks")}</ButtonLink>}</div>
		{saving && <p>{t("common.loading")}</p>}{templateSaved && <Notice tone="success">{t("commandsPage.templateSaved")}</Notice>}
		{templateFailed && <Notice tone="warning" action={{ label: t("commandsPage.retryTemplate"), onClick: () => void persistTemplate(templateFailed) }}>{t("commandsPage.templateFailed")}</Notice>}
		<ActionButton disabled={saving} variant="secondary" onClick={() => { key.current = null; setReceipt(null); setAssessment(null); setTemplateSaved(false); setTemplateFailed(null); setSave(false); setCommand(""); setTitle(""); setReason(""); setTemplateName(""); setDescription(""); setVariables({}); }}>{t("commandsPage.new")}</ActionButton>
	</section>;
	return <><form aria-label={t("serversPage.command.title")} className="space-y-4" onSubmit={e => { e.preventDefault(); if (!ready) return; if (!requiresReview || elevated) { setError(""); setConfirm(true); } else void dispatch(); }}>
		<fieldset disabled={submitting} className="space-y-4">
		<section data-card className="space-y-3 p-4"><h2 className="ui-title-section">{t("commandsPage.targets")}</h2>
			{remoteTargets ? <ServerTargetPicker kind="command" selected={remote} onChange={rows => { setRemote(rows); setSelected(rows.map(s => s.id)); }} /> : <>
				<input type="search" className={UI_INPUT} aria-label={t("serversPage.inventory.search")} placeholder={t("serversPage.inventory.search")} value={query} onChange={e => setQuery(e.target.value)} />
				<div className="flex flex-wrap gap-2"><ActionButton variant="secondary" onClick={() => setSelected(available.map(s => s.id))}>{t("serversPage.command.selectAllEnabled")}</ActionButton><ActionButton variant="secondary" disabled={!selected.length} onClick={() => setSelected([])}>{t("serversPage.command.deselectAll")}</ActionButton></div>
				<div className="grid max-h-72 gap-2 overflow-auto sm:grid-cols-2">{visible.map(s => <label key={s.id} data-tile className="flex items-start gap-3 p-2 text-sm"><input type="checkbox" disabled={s.available === false} checked={selected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))} />
					<span>{s.name} {s.operatingSystem && <Badge>{s.operatingSystem}</Badge>}<code className="block">{s.host}</code><small>{s.unavailableReason || t("commandsPage.available")}</small></span></label>)}</div>
				{!visible.length && <p>{t("serversPage.inventory.noResults")}</p>}
			</>}
			<p className="text-xs" role="status">{selected.length ? t("serversPage.command.selectedSummary", { count: selected.length, names: targets.map(s => s.name).join(t("common.listSeparator")) }) : t("serversPage.command.selectRequired")}</p>
			{!withinTargetLimit && <Notice tone="warning">{t("commandsPage.tooManyTargets")}</Notice>}
		</section>
		<section data-card className="space-y-3 p-4"><h2 className="ui-title-section">{t("commandsPage.command")}</h2>
			<label className="ui-label grid gap-1">{t("serversPage.command.titleLabel")}<input className={UI_INPUT} maxLength={120} placeholder={t("commandsPage.autoTitle")} value={title} onChange={e => setTitle(e.target.value)} /></label>
			<label className="ui-label grid gap-1">{t("serversPage.command.bodyLabel")}<textarea className={`${UI_INPUT} font-mono`} rows={5} spellCheck={false} ref={editor} required maxLength={MAX_COMMAND_BODY_LENGTH} value={command} onChange={e => setCommand(e.target.value)} /></label>
			<EditorSnippetPicker editor={editor} onChange={setCommand} mode="immediate" canReadSavedSnippets={canReadSavedSnippets} osHint={targets.length === 1 && 'operatingSystem' in targets[0]! ? targets[0].operatingSystem : undefined} />
			{names.map(n => <label key={n} className="ui-label grid gap-1">{n}<input className={UI_INPUT} required value={Object.hasOwn(variables, n) ? variables[n] : ""} onChange={e => setVariables({ ...variables, [n]: e.target.value })} /></label>)}
			{body.length > MAX_COMMAND_BODY_LENGTH && <Notice tone="danger">{t("snippetsPage.picker.tooLong")}</Notice>}
			<label className="ui-label grid gap-1">{t("serversPage.command.reasonLabel")}<input className={UI_INPUT} maxLength={500} placeholder={t("common.optional")} value={reason} onChange={e => setReason(e.target.value)} /></label>
		</section>
		<section data-card className="space-y-3 p-4"><h2 className="ui-title-section">{t("commandsPage.preview")}</h2>
			{allowDirectExecution && <label className="flex items-center gap-2"><input type="checkbox" checked={peer} onChange={e => setPeer(e.target.checked)} />{t("commandsPage.peer")}</label>}
			<div aria-live="polite">{preview ? <><Badge tone={elevated ? "danger" : "accent"}>{riskLabel(preview.riskLevel)}</Badge> <strong>{t(requiresReview ? "commandsPage.review" : "commandsPage.direct")}</strong>
				<ul className="list-inside list-disc text-sm">{preview.riskReasons.map(r => <li key={r}>{riskReason(r)}</li>)}</ul>{preview.denylisted && <Notice tone="danger">{t("commandsPage.denylisted")}</Notice>}</>
				: assessment?.payload === previewPayload && assessment.failed ? <Notice tone="warning" action={{ label: t("common.retry"), onClick: () => setAttempt(a => a + 1) }}>{t("commandsPage.previewFailed")}</Notice> : <p>{t(!withinTargetLimit ? "commandsPage.tooManyTargets" : validBody ? "common.loading" : "commandsPage.previewHint")}</p>}</div>
		</section>
		<section data-card className="space-y-3 p-4"><h2 className="ui-title-section">{t("commandsPage.reuse")}</h2><label className="flex items-center gap-2"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} />{t("commandsPage.saveTemplate")}</label>
			{save && <><label className="ui-label grid gap-1">{t("commandsPage.templateName")}<input className={UI_INPUT} required maxLength={120} value={templateName} onChange={e => setTemplateName(e.target.value)} /></label>
				<label className="ui-label grid gap-1">{t("commandsPage.description")}<input className={UI_INPUT} maxLength={500} value={description} onChange={e => setDescription(e.target.value)} /></label></>}
		</section></fieldset>
		{error && !confirm && <Notice tone="danger">{error}</Notice>}
		<ActionButton type="submit" disabled={!ready}>{t(submitting ? "serversPage.command.submitting" : requiresReview ? "serversPage.command.submitApproval" : "serversPage.command.submitDirect")}</ActionButton>
	</form><ConfirmDialog open={confirm} title={t(requiresReview ? "commandsPage.confirmReview" : "serversPage.command.directConfirmTitle")} busy={submitting} closeOnBackdrop={false} error={error}
		description={<div className="space-y-2">{elevated && <Notice tone="danger">{t("commandsPage.elevated")}</Notice>}<p>{t("commandsPage.targetCount", { count: selected.length })}: {targets.map(s => s.name).join(t("common.listSeparator"))}</p><p>{reason}</p><pre className="max-h-52 overflow-auto whitespace-pre-wrap">{body}</pre></div>}
		onCancel={() => { if (!submitting) setConfirm(false); }} onConfirm={() => void dispatch()} cancelLabel={t("common.cancel")} confirmLabel={t(requiresReview ? "serversPage.command.submitApproval" : "serversPage.command.directConfirmAction")} /></>;
}
