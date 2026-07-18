"use client";

import { useCallback, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { EmptyState, SurfacePanel, Toolbar } from "@/components/page-shell";
import { useToast } from "@/components/toast-provider";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import type { Locale } from "@/lib/i18n/translations";

import { CreateTemplateForm } from "./create-template-form";
import { DeployButton } from "./template-deploy-button";
import type { ServerOption, Template } from "./template-types";

type Props = {
	templates: Template[];
	servers: ServerOption[];
	canCreate: boolean;
	canDeploy?: boolean;
	locale?: Locale;
};

export function TemplateListClient({
	templates: initialTemplates,
	servers,
	canCreate,
	canDeploy = false,
	locale: _locale,
}: Props) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const [templates, setTemplates] = useState(initialTemplates);
	const [showCreate, setShowCreate] = useState(false);
	const [filterTag, setFilterTag] = useState<string | null>(null);
	const [deploying, setDeploying] = useState<string | null>(null);
	const [templatePendingDelete, setTemplatePendingDelete] = useState<Template | null>(null);

	const closeDeleteDialog = useCallback(() => setTemplatePendingDelete(null), []);
	const dialogRef = useDialogFocus<HTMLDivElement>({
		open: templatePendingDelete !== null,
		onClose: closeDeleteDialog,
	});

	const allTags = [...new Set(templates.flatMap((item) => item.tags))].sort();
	const filtered = filterTag
		? templates.filter((item) => item.tags.includes(filterTag))
		: templates;

	const refresh = useCallback(async () => {
		const data = await csrfFetch("/api/command-templates");
		setTemplates(data.templates ?? []);
	}, []);

	const handleDelete = useCallback(
		async (id: string) => {
			try {
				await csrfFetch(`/api/command-templates?id=${id}`, { method: "DELETE" });
				setTemplatePendingDelete(null);
				await refresh();
				addToast("success", t("templatesPage.toast.deleted"));
			} catch (err) {
				addToast(
					"error",
					err instanceof Error ? err.message : t("templatesPage.toast.deleteFailed"),
				);
			}
		},
		[addToast, refresh, t],
	);

	const handleDeploy = useCallback(
		async (template: Template, serverIds: string[], vars: Record<string, string>) => {
			const missingVariable = template.variables.find((name) => !vars[name]?.trim());
			if (missingVariable) {
				addToast(
					"error",
					t("templatesPage.toast.missingVar").replace("{name}", missingVariable),
				);
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
				addToast(
					"error",
					err instanceof Error ? err.message : t("templatesPage.toast.submitFailed"),
				);
			}
			setDeploying(null);
		},
		[addToast, t],
	);

	return (
		<div className="space-y-6">
			{templatePendingDelete && (
				<div
					ref={dialogRef}
					className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
					role="dialog"
					aria-modal="true"
					aria-labelledby="delete-template-title"
				>
					<div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl shadow-black/30">
						<h3
							id="delete-template-title"
							className="text-base font-semibold text-[var(--text-primary)]"
						>
							{t("templatesPage.delete.title")}
						</h3>
						<p className="mt-2 text-sm text-[var(--text-muted)]">
							{t("templatesPage.delete.confirm").replace(
								"{name}",
								templatePendingDelete.name,
							)}
						</p>
						<div className="mt-5 flex justify-end gap-2">
							<ActionButton
								type="button"
								variant="secondary"
								onClick={() => setTemplatePendingDelete(null)}
								className="min-h-11"
							>
								{t("templatesPage.delete.cancel")}
							</ActionButton>
							<ActionButton
								type="button"
								variant="danger"
								onClick={() => handleDelete(templatePendingDelete.id)}
								className="min-h-11"
							>
								{t("templatesPage.delete.confirm2")}
							</ActionButton>
						</div>
					</div>
				</div>
			)}

			<Toolbar className="justify-between">
				{allTags.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-xs text-[var(--text-muted)]">
							{t("templatesPage.filter.label")}
						</span>
						<button
							type="button"
							onClick={() => setFilterTag(null)}
							data-tone={!filterTag ? "accent" : undefined}
							className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
								!filterTag
									? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
									: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
							}`}
						>
							{t("templatesPage.filter.all")}
						</button>
						{allTags.map((tag) => (
							<button
								key={tag}
								type="button"
								onClick={() => setFilterTag(filterTag === tag ? null : tag)}
								data-tone={filterTag === tag ? "accent" : undefined}
								className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
									filterTag === tag
										? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
										: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
								}`}
							>
								#{tag}
							</button>
						))}
					</div>
				)}
				{canCreate && !showCreate && (
					<ActionButton type="button" onClick={() => setShowCreate(true)} className="min-h-11 px-5">
						{t("templatesPage.action.create")}
					</ActionButton>
				)}
			</Toolbar>

			{showCreate && (
				<div className="mb-1">
					<SurfacePanel title={t("templatesPage.action.create")}>
						<CreateTemplateForm
							onClose={() => {
								setShowCreate(false);
								void refresh();
							}}
						/>
					</SurfacePanel>
				</div>
			)}

			{filtered.length === 0 ? (
				<EmptyState icon="📝" variant="boxed">
					{t("templatesPage.empty")}
				</EmptyState>
			) : (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{filtered.map((tmpl) => (
						<article
							key={tmpl.id}
							data-card
							className="flex flex-col p-4 transition-colors duration-150 hover:bg-[var(--surface-elevated)]"
						>
							<div className="flex items-start justify-between gap-2">
								<div>
									<h3 className="text-sm font-semibold text-[var(--text-primary)]">
										{tmpl.name}
									</h3>
									{tmpl.description && (
										<p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
											{tmpl.description}
										</p>
									)}
								</div>
								{tmpl.isBuiltin && (
									<span
										data-tone="accent"
										className="shrink-0 rounded-lg border px-1.5 py-0.5 text-[9px] font-medium"
									>
										{t("templatesPage.badge.builtin")}
									</span>
								)}
							</div>
							<div className="mt-2.5 line-clamp-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-2 font-mono text-xs text-[var(--text-secondary)]">
								{tmpl.command}
							</div>
							{tmpl.rollbackCommand && (
								<div
									data-tone="emerald"
									className="mt-2 line-clamp-2 rounded-lg border border-[var(--success-border)] px-3 py-2 font-mono text-xs text-[var(--success)] light:border-[var(--success-border)]"
								>
									<span className="mr-2 font-sans text-[10px] uppercase tracking-[0.2em] text-[var(--success)]">
										{t("templatesPage.badge.rollback")}
									</span>
									{tmpl.rollbackCommand}
								</div>
							)}
							{tmpl.variables.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-1">
									{tmpl.variables.map((v) => (
										<span
											key={v}
											data-tone="warning"
											className="rounded-lg border px-1.5 py-0.5 font-mono text-[10px]"
										>
											{`{{${v}}}`}
										</span>
									))}
								</div>
							)}
							{tmpl.tags.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-1">
									{tmpl.tags.map((tag) => (
										<span
											key={tag}
											className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
										>
											#{tag}
										</span>
									))}
								</div>
							)}
							<div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-2">
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
										type="button"
										onClick={() => setTemplatePendingDelete(tmpl)}
										className="min-h-11 min-w-11 text-[11px] text-[var(--danger)]/60 transition hover:text-[var(--danger)]"
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
