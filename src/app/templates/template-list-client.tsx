"use client";

import { useState, useCallback, useId } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { EmptyState } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
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

	const closeDeleteDialog = useCallback(() => setTemplatePendingDelete(null), []);
	const dialogRef = useDialogFocus<HTMLDivElement>({ open: templatePendingDelete !== null, onClose: closeDeleteDialog });

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
				<div ref={dialogRef} className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-template-title">
					<div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl shadow-black/30">
						<h3 id="delete-template-title" className="text-base font-semibold text-[var(--text-primary)]">{t("templatesPage.delete.title")}</h3>
						<p className="mt-2 text-sm text-[var(--text-muted)]">{t("templatesPage.delete.confirm").replace("{name}", templatePendingDelete.name)}</p>
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setTemplatePendingDelete(null)}
								data-card className="min-h-11 px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/[0.10]"
							>
								{t("templatesPage.delete.cancel")}
							</button>
							<button
								type="button"
								onClick={() => handleDelete(templatePendingDelete.id)}
								data-tone="rose" className="min-h-11 rounded-xl border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)]"
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
						<span className="text-xs text-[var(--text-muted)]">{t("templatesPage.filter.label")}</span>
						<button
							onClick={() => setFilterTag(null)}
							data-tone={!filterTag ? "accent" : undefined}
							className={`rounded-lg border px-2 py-0.5 text-[11px] transition ${!filterTag ? "" : "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-muted)] hover:bg-[var(--surface)]/[0.10]"}`}
						>
							{t("templatesPage.filter.all")}
						</button>
						{allTags.map((tag) => (
							<button
								key={tag}
								onClick={() => setFilterTag(filterTag === tag ? null : tag)}
								data-tone={filterTag === tag ? "accent" : undefined}
								className={`rounded-lg border px-2 py-0.5 text-[11px] transition ${filterTag === tag ? "" : "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-muted)] hover:bg-[var(--surface)]/[0.10]"}`}
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
						<article key={tmpl.id} data-card className=" p-4 hover:bg-[var(--surface)]/[0.04] transition-colors duration-150 flex flex-col">
							<div className="flex items-start justify-between gap-2">
								<div>
									<h3 className="text-sm font-semibold text-[var(--text-primary)]">{tmpl.name}</h3>
									{tmpl.description && <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{tmpl.description}</p>}
								</div>
								{tmpl.isBuiltin && (
									<span data-tone="accent" className="rounded-lg border px-1.5 py-0.5 text-[9px] font-medium shrink-0">{t("templatesPage.badge.builtin")}</span>
								)}
							</div>
							<div className="mt-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/70 px-3 py-2 font-mono text-xs text-[var(--text-secondary)] line-clamp-2">
								{tmpl.command}
							</div>
							{tmpl.rollbackCommand && (
								<div data-tone="emerald" className="mt-2 rounded-lg border border-[var(--success-border)] px-3 py-2 font-mono text-xs text-[var(--success)] line-clamp-2 light:border-[var(--success-border)] light:bg-[var(--success)]">
									<span className="mr-2 font-sans text-[10px] uppercase tracking-[0.2em] text-[var(--success)]">Rollback</span>{tmpl.rollbackCommand}
								</div>
							)}
							{tmpl.variables.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-1">
{tmpl.variables.map((v) => {
											const placeholder = `{{${v}}}`;
											return <span key={v} data-tone="warning" className="rounded-lg border px-1.5 py-0.5 text-[10px] font-mono">{placeholder}</span>;
										})}
								</div>
							)}
							{tmpl.tags.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-1">
									{tmpl.tags.map((tag) => (
										<span key={tag} className="rounded-lg bg-[var(--surface)]/[0.04] border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">#{tag}</span>
									))}
								</div>
							)}
							<div className="mt-3 flex items-center gap-2 pt-2 border-t border-[var(--border)]">
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
										className="min-h-11 min-w-11 text-[11px] text-[var(--danger)]/60 hover:text-[var(--danger)] transition"
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
				className="min-h-11 rounded-lg bg-[var(--color-action)]/80 px-3 py-1 text-[11px] font-medium text-[var(--color-action-fg)] hover:bg-[var(--color-action-bg)] transition"
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
						<label htmlFor={variableInputId} className="text-[11px] text-[var(--warning)] font-mono w-24 shrink-0">{variableLabel}</label>
						<input
							id={variableInputId}
							value={vars[v] ?? ""}
							onChange={(e) => setVars((prev) => ({ ...prev, [v]: e.target.value }))}
							placeholder={`{{${v}}}`}
							className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-2 py-1 text-[11px] text-[var(--text-primary)] font-mono outline-none placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30"
						/>
					</div>
			)})}
			<div className="flex flex-wrap gap-1">
				{enabledServers.map((s) => (
					<label key={s.id} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] cursor-pointer transition ${selectedIds.has(s.id) ? "border-[var(--color-action-border)]/20 bg-[var(--color-action-bg)]/[0.10] text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-muted)]"}`}>
						<input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => {
							setSelectedIds((prev) => { const n = new Set(prev); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; });
						}} className="accent-[var(--color-action)]" />
						{s.name}
					</label>
				))}
			</div>
			<div className="flex gap-2">
				<button
					onClick={() => onDeploy(template, [...selectedIds], vars)}
					disabled={loading || selectedIds.size === 0}
					className="min-h-11 rounded-lg bg-[var(--color-action)] px-3 py-1 text-[11px] font-medium text-[var(--color-action-fg)] hover:bg-[var(--color-action-bg)] disabled:opacity-60 transition"
				>
					{loading ? t("templatesPage.action.submitting") : t("templatesPage.action.submit")}
				</button>
				<button onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface)]/[0.10] transition">
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
			<h3 className="text-lg font-semibold text-[var(--text-primary)]">{t("templatesPage.create.title")}</h3>
			{error && <div className="rounded-lg bg-[var(--danger)]/[0.10] border border-[var(--danger-border)] px-3.5 py-2.5 text-sm text-[var(--danger)]">{error}</div>}
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-name`} className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">{t("templatesPage.create.nameLabel")}</label>
				<input id={`${createFormId}-name`} value={name} onChange={(e) => setName(e.target.value)} required placeholder={t("templatesPage.create.namePlaceholder")} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30" />
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-description`} className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">{t("templatesPage.create.descLabel")}</label>
				<input id={`${createFormId}-description`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("templatesPage.create.descPlaceholder")} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30" />
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-command`} className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">{t("templatesPage.create.commandLabel")}</label>
				<textarea id={`${createFormId}-command`} value={command} onChange={(e) => setCommand(e.target.value)} required rows={3} placeholder={t("templatesPage.create.commandPlaceholder")} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 resize-y" />
				<p className="text-[11px] text-[var(--text-muted)]">{t("templatesPage.create.commandHint")}</p>
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-rollback-command`} className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">{t("templatesPage.create.rollbackLabel")}</label>
				<textarea id={`${createFormId}-rollback-command`} value={rollbackCommand} onChange={(e) => setRollbackCommand(e.target.value)} rows={3} placeholder={t("templatesPage.create.rollbackPlaceholder")} data-tone="emerald" className="w-full rounded-lg border border-[var(--success-border)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] light:border-[var(--success-border)] light:bg-[var(--success)] font-mono outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--success-border)] resize-y" />
				<p className="text-[11px] text-[var(--text-muted)]">{t("templatesPage.create.rollbackHint")}</p>
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-tags`} className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">{t("templatesPage.create.tagsLabel")}</label>
				<input id={`${createFormId}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("templatesPage.create.tagsPlaceholder")} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30" />
			</div>
			<div className="flex gap-3 pt-2">
				<button type="submit" disabled={submitting} className="min-h-11 rounded-2xl bg-[var(--color-action)] px-5 py-2 text-sm font-medium text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)] disabled:opacity-60">
					{submitting ? t("templatesPage.create.submitting") : t("templatesPage.create.submit")}
				</button>
				<button type="button" onClick={onClose} className="min-h-11 rounded-2xl border border-[var(--border)] px-5 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface)]/10 transition">
					{t("templatesPage.action.cancel")}
				</button>
			</div>
		</form>
	);
}
