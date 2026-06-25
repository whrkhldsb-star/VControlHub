"use client";

import { useState, useCallback, useId } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { EmptyState } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";
import type { Locale } from "@/lib/i18n/translations";

type Template = {
	id: string; name: string; description: string | null;
	command: string; rollbackCommand?: string | null; variables: string[]; tags: string[];
	isBuiltin: boolean; createdAt: string;
	creator: { username: string; displayName: string | null } | null;
};

type ServerOption = { id: string; name: string; enabled: boolean };

type Props = {
	templates: Template[];
	servers: ServerOption[];
	canCreate: boolean;
	canDeploy?: boolean;
	locale?: Locale;
};

export function TemplateListClient({ templates: initialTemplates, servers, canCreate, canDeploy = false, locale: _locale }: Props) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const [templates, setTemplates] = useState(initialTemplates);
	const [showCreate, setShowCreate] = useState(false);
	const [filterTag, setFilterTag] = useState<string | null>(null);
	const [deploying, setDeploying] = useState<string | null>(null);
	const [templatePendingDelete, setTemplatePendingDelete] = useState<Template | null>(null);

	const allTags = [...new Set(templates.flatMap((t) => t.tags))].sort();

	const filtered = filterTag
		? templates.filter((t) => t.tags.includes(filterTag))
		: templates;

	const refresh = useCallback(async () => {
		const data = await csrfFetch("/api/command-templates");
		setTemplates(data.templates ?? []);
	}, []);

	const handleDelete = useCallback(async (id: string) => {
		try {
			await csrfFetch(`/api/command-templates?id=${id}`, { method: "DELETE" });
			setTemplatePendingDelete(null);
			await refresh();
			addToast("success", t("templatesPage.toast.deleted"));
		} catch (err) {
			addToast("error", err instanceof Error ? err.message : t("templatesPage.toast.deleteFailed"));
		}
	}, [addToast, refresh, t]);

	const handleDeploy = useCallback(async (template: Template, serverIds: string[], vars: Record<string, string>) => {
		const missingVariable = template.variables.find((name) => !vars[name]?.trim());
		if (missingVariable) {
			addToast("error", t("templatesPage.toast.missingVar").replace("{name}", missingVariable));
			return;
		}
		setDeploying(template.id);
		try {
			await csrfFetch("/api/deployments", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					templateId: template.id,
					serverIds,
					variables: vars,
					reason: t("templatesPage.deployReason").replace("{name}", template.name),
				}),
			});
			addToast("success", t("templatesPage.toast.submitted"));
		} catch (err) {
			addToast("error", err instanceof Error ? err.message : t("templatesPage.toast.submitFailed"));
		}
		setDeploying(null);
	}, [addToast, t]);

	return (
		<div className="space-y-6">
			{templatePendingDelete && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-template-title">
					<div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-slate-950 p-5 shadow-2xl shadow-black/30">
						<h3 id="delete-template-title" className="text-base font-semibold text-white">{t("templatesPage.delete.title")}</h3>
						<p className="mt-2 text-sm text-slate-400">{t("templatesPage.delete.confirm").replace("{name}", templatePendingDelete.name)}</p>
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setTemplatePendingDelete(null)}
								data-card className="min-h-11 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.06]"
							>
								{t("templatesPage.delete.cancel")}
							</button>
							<button
								type="button"
								onClick={() => handleDelete(templatePendingDelete.id)}
								data-tone="rose" className="min-h-11 rounded-xl border border-rose-400/30 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/25"
							>
								{t("templatesPage.delete.confirm2")}
							</button>
						</div>
					</div>
				</div>
			)}
			{/* Controls */}
			<div className="flex items-center justify-between flex-wrap gap-3">
				{/* Tag filter */}
				{allTags.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-xs text-slate-500">{t("templatesPage.filter.label")}</span>
						<button
							onClick={() => setFilterTag(null)}
							data-tone={!filterTag ? "accent" : undefined}
							className={`rounded-md border px-2 py-0.5 text-[11px] transition ${!filterTag ? "" : "border-white/[0.06] bg-white/[0.02] text-slate-500 hover:bg-white/[0.05]"}`}
						>
							{t("templatesPage.filter.all")}
						</button>
						{allTags.map((tag) => (
							<button
								key={tag}
								onClick={() => setFilterTag(filterTag === tag ? null : tag)}
								data-tone={filterTag === tag ? "accent" : undefined}
								className={`rounded-md border px-2 py-0.5 text-[11px] transition ${filterTag === tag ? "" : "border-white/[0.06] bg-white/[0.02] text-slate-500 hover:bg-white/[0.05]"}`}
							>
								#{tag}
							</button>
						))}
					</div>
				)}
				{canCreate && !showCreate && (
					<button
						onClick={() => setShowCreate(true)}
						data-tone="accent"
						className="min-h-11 rounded-2xl border px-5 py-2.5 text-sm font-medium transition"
					>
						{t("templatesPage.action.create")}
					</button>
				)}
			</div>

			{showCreate && (
				<CreateTemplateForm onClose={() => { setShowCreate(false); refresh(); }} />
			)}

			{/* Template grid */}
			{filtered.length === 0 ? (
				<EmptyState icon="📝" variant="boxed">
					{t("templatesPage.empty")}
				</EmptyState>
			) : (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{filtered.map((tmpl) => (
						<article key={tmpl.id} data-card className=" p-4 hover:bg-white/[0.04] transition-colors duration-150 flex flex-col">
							<div className="flex items-start justify-between gap-2">
								<div>
									<h3 className="text-sm font-semibold text-white">{tmpl.name}</h3>
									{tmpl.description && <p className="mt-0.5 text-[11px] text-slate-500">{tmpl.description}</p>}
								</div>
								{tmpl.isBuiltin && (
									<span data-tone="accent" className="rounded-md border px-1.5 py-0.5 text-[9px] font-medium shrink-0">{t("templatesPage.badge.builtin")}</span>
								)}
							</div>
							<div className="mt-2.5 rounded-lg border border-white/[0.06] bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-300 line-clamp-2">
								{tmpl.command}
							</div>
							{tmpl.rollbackCommand && (
								<div data-tone="emerald" className="mt-2 rounded-lg border border-emerald-400/20 px-3 py-2 font-mono text-xs text-emerald-100 line-clamp-2 light:border-emerald-200 light:bg-emerald-50">
									<span className="mr-2 font-sans text-[10px] uppercase tracking-[0.2em] text-emerald-300">Rollback</span>{tmpl.rollbackCommand}
								</div>
							)}
							{tmpl.variables.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-1">
{tmpl.variables.map((v) => {
											const placeholder = `{{${v}}}`;
											return <span key={v} data-tone="warning" className="rounded-md border px-1.5 py-0.5 text-[10px] font-mono">{placeholder}</span>;
										})}
								</div>
							)}
							{tmpl.tags.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-1">
									{tmpl.tags.map((tag) => (
										<span key={tag} className="rounded-md bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-500">#{tag}</span>
									))}
								</div>
							)}
							<div className="mt-3 flex items-center gap-2 pt-2 border-t border-white/[0.04]">
								{canDeploy && (
									<DeployButton
										template={tmpl}
										servers={servers}
										onDeploy={handleDeploy}
										loading={deploying === tmpl.id}
									/>
								)}
								{canCreate && !tmpl.isBuiltin && (
									<button
										onClick={() => setTemplatePendingDelete(tmpl)}
										className="min-h-11 min-w-11 text-[11px] text-rose-400/60 hover:text-rose-300 transition"
										>
										{t("templatesPage.delete.action")}
									</button>
								)}
							</div>
						</article>
					))}
				</div>
			)}
		</div>
	);
}

/* ── Deploy button with variable form + server select ─────── */

function DeployButton({ template, servers, onDeploy, loading }: {
	template: Template; servers: ServerOption[];
	onDeploy: (t: Template, s: string[], v: Record<string, string>) => void;
	loading: boolean;
}) {
	const { t } = useI18n();
	const deployFormId = useId();
	const [open, setOpen] = useState(false);
	const [vars, setVars] = useState<Record<string, string>>({});
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	if (!open) {
		return (
			<button
				onClick={() => setOpen(true)}
				className="min-h-11 rounded-lg bg-cyan-500/80 px-3 py-1 text-[11px] font-medium text-slate-950 hover:bg-cyan-400 transition"
			>
				{t("templatesPage.action.deploy")}
			</button>
		);
	}

	const enabledServers = servers.filter((s) => s.enabled);

	return (
		<div className="w-full space-y-2.5">
			{template.variables.map((v) => {
				const variableInputId = `${deployFormId}-${v}`;
				const variableLabel = t("templatesPage.variable").replace("{name}", v);
				return (
					<div key={v} className="flex items-center gap-2">
						<label htmlFor={variableInputId} className="text-[11px] text-amber-200 font-mono w-24 shrink-0">{variableLabel}</label>
						<input
							id={variableInputId}
							value={vars[v] ?? ""}
							onChange={(e) => setVars((prev) => ({ ...prev, [v]: e.target.value }))}
							placeholder={`{{${v}}}`}
							className="flex-1 rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[11px] text-white font-mono outline-none placeholder:text-white/20 focus:border-cyan-400/30"
						/>
					</div>
			)})}
			<div className="flex flex-wrap gap-1">
				{enabledServers.map((s) => (
					<label key={s.id} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] cursor-pointer transition ${selectedIds.has(s.id) ? "border-cyan-400/20 bg-cyan-400/[0.06] text-white" : "border-white/[0.06] bg-white/[0.03] text-slate-400"}`}>
						<input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => {
							setSelectedIds((prev) => { const n = new Set(prev); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; });
						}} className="accent-cyan-400" />
						{s.name}
					</label>
				))}
			</div>
			<div className="flex gap-2">
				<button
					onClick={() => onDeploy(template, [...selectedIds], vars)}
					disabled={loading || selectedIds.size === 0}
					className="min-h-11 rounded-lg bg-cyan-500 px-3 py-1 text-[11px] font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60 transition"
				>
					{loading ? t("templatesPage.action.submitting") : t("templatesPage.action.submit")}
				</button>
				<button onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] text-slate-400 hover:bg-white/[0.06] transition">
					{t("templatesPage.action.cancel")}
				</button>
			</div>
		</div>
	);
}

/* ── Create template form ─────────────────────────────────── */

function CreateTemplateForm({ onClose }: { onClose: () => void }) {
	const { t } = useI18n();
	const createFormId = useId();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [command, setCommand] = useState("");
	const [rollbackCommand, setRollbackCommand] = useState("");
	const [tags, setTags] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const _data = await csrfFetch("/api/command-templates", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name, description: description || null, command, rollbackCommand: rollbackCommand.trim() || null,
					tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
				}),
			});
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("templatesPage.error.createFailed"));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} data-card className=" space-y-4">
			<h3 className="text-lg font-semibold text-white">{t("templatesPage.create.title")}</h3>
			{error && <div className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200">{error}</div>}
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-name`} className="text-xs font-medium text-white/50 tracking-wide">{t("templatesPage.create.nameLabel")}</label>
				<input id={`${createFormId}-name`} value={name} onChange={(e) => setName(e.target.value)} required placeholder={t("templatesPage.create.namePlaceholder")} className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30" />
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-description`} className="text-xs font-medium text-white/50 tracking-wide">{t("templatesPage.create.descLabel")}</label>
				<input id={`${createFormId}-description`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("templatesPage.create.descPlaceholder")} className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30" />
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-command`} className="text-xs font-medium text-white/50 tracking-wide">{t("templatesPage.create.commandLabel")}</label>
				<textarea id={`${createFormId}-command`} value={command} onChange={(e) => setCommand(e.target.value)} required rows={3} placeholder={t("templatesPage.create.commandPlaceholder")} className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white font-mono outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 resize-y" />
				<p className="text-[11px] text-slate-600">{t("templatesPage.create.commandHint")}</p>
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-rollback-command`} className="text-xs font-medium text-white/50 tracking-wide">{t("templatesPage.create.rollbackLabel")}</label>
				<textarea id={`${createFormId}-rollback-command`} value={rollbackCommand} onChange={(e) => setRollbackCommand(e.target.value)} rows={3} placeholder={t("templatesPage.create.rollbackPlaceholder")} data-tone="emerald" className="w-full rounded-lg border border-emerald-400/20 px-3.5 py-2.5 text-sm text-white light:border-emerald-200 light:bg-emerald-50 font-mono outline-none transition placeholder:text-white/20 focus:border-emerald-400/40 resize-y" />
				<p className="text-[11px] text-slate-600">{t("templatesPage.create.rollbackHint")}</p>
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-tags`} className="text-xs font-medium text-white/50 tracking-wide">{t("templatesPage.create.tagsLabel")}</label>
				<input id={`${createFormId}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("templatesPage.create.tagsPlaceholder")} className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30" />
			</div>
			<div className="flex gap-3 pt-2">
				<button type="submit" disabled={submitting} className="min-h-11 rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60">
					{submitting ? t("templatesPage.create.submitting") : t("templatesPage.create.submit")}
				</button>
				<button type="button" onClick={onClose} className="min-h-11 rounded-2xl border border-[var(--border)] px-5 py-2 text-sm text-slate-300 hover:bg-white/10 transition">
					{t("templatesPage.action.cancel")}
				</button>
			</div>
		</form>
	);
}
