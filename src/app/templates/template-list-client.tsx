"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { EmptyState, SurfacePanel, Toolbar } from "@/components/page-shell";
import { useToast } from "@/components/toast-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import type { Locale } from "@/lib/i18n/translations";

import { TemplateForm } from "./template-form";
import { DeployButton } from "./template-deploy-button";
import type { ServerOption, Template } from "./template-types";
import { getErrorMessage } from "@/lib/http/error-message";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { StatusBadge } from "@/components/status-badge";
import { Badge, Chip } from "@/components/ui-primitives";
import { Plus } from "@/components/icons";
import { IconFileCode } from "@/components/nav-icons";

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
	// The template whose changes the form holds; null while it makes a new one.
	const [editing, setEditing] = useState<Template | null>(null);
	const formPanelRef = useRef<HTMLDivElement>(null);
	// The form opens above the cards: bring it into view (the edit button may be far down the page).
	useEffect(() => {
		if (showCreate) formPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
	}, [showCreate, editing]);
	const { state: filters, setField: setFilter } = useUrlQueryState({ tag: "" });
	const filterTag = filters.tag || null;
	const setFilterTag = (tag: string | null) => setFilter("tag", tag ?? "");
	const [deploying, setDeploying] = useState<string | null>(null);
	const [templatePendingDelete, setTemplatePendingDelete] = useState<Template | null>(null);
	const [deleteBusy, setDeleteBusy] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const closeDeleteDialog = useCallback(() => setTemplatePendingDelete(null), []);

	const allTags = [...new Set(templates.flatMap((item) => item.tags))].sort();
	const filtered = filterTag
		? templates.filter((item) => item.tags.includes(filterTag))
		: templates;

	// Reads the list again; says so when it cannot. It used to throw into whatever had just succeeded.
	const refresh = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/command-templates");
			setTemplates(data.templates ?? []);
		} catch (err) {
			addToast("error", getErrorMessage(err, t("templatesPage.toast.refreshFailed")));
		}
	}, [addToast, t]);

	const handleDelete = useCallback(
		async (id: string) => {
			setDeleteBusy(true);
			setDeleteError(null);
			try {
				await csrfFetch(`/api/command-templates?id=${encodeURIComponent(id)}`, { method: "DELETE" });
			} catch (err) {
				// In the dialog that asked, which stays open.
				setDeleteError(getErrorMessage(err, t("templatesPage.toast.deleteFailed")));
				setDeleteBusy(false);
				return;
			}
			// Gone, whatever reading the list again says: with both in one try, an unanswered refresh reported
			// the deletion as failed and left the card in place.
			setTemplatePendingDelete(null);
			setDeleteBusy(false);
			setTemplates((current) => current.filter((item) => item.id !== id));
			addToast("success", t("templatesPage.toast.deleted"));
			void refresh();
		},
		[addToast, refresh, t],
	);

	const handleDeploy = useCallback(
		async (template: Template, serverIds: string[], vars: Record<string, string>): Promise<boolean> => {
			const missingVariable = template.variables.find((name) => !vars[name]?.trim());
			if (missingVariable) {
				addToast(
					"error",
					t("templatesPage.toast.missingVar", { name: missingVariable }),
				);
				return false;
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
						reason: t("templatesPage.deployReason", { name: template.name }),
					}),
				});
				// Template deployments route through the approval chain — surface
				// where to go instead of leaving the user to guess.
				addToast("success", t("templatesPage.toast.submitted"), {
					duration: 8000,
					action: { label: t("templatesPage.toast.viewDeployments"), href: "/deployments" },
				});
				return true;
			} catch (err) {
				addToast(
					"error",
					getErrorMessage(err, t("templatesPage.toast.submitFailed")),
				);
				return false;
			} finally {
				setDeploying(null);
			}
		},
		[addToast, t],
	);

	return (
		<div className="space-y-6">
			<ConfirmDialog
				open={templatePendingDelete !== null}
				title={t("templatesPage.delete.title")}
				description={t("templatesPage.delete.confirm", { name: templatePendingDelete?.name ?? "" })}
				cancelLabel={t("templatesPage.delete.cancel")}
				confirmLabel={t("templatesPage.delete.confirm2")}
				busy={deleteBusy}
				error={deleteError}
				onCancel={closeDeleteDialog}
				onConfirm={() => templatePendingDelete && handleDelete(templatePendingDelete.id)}
				closeOnBackdrop={false}
			/>

			<Toolbar className="justify-between">
				{allTags.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-xs text-[var(--text-muted)]">
							{t("templatesPage.filter.label")}
						</span>
						<Chip
							selected={!filterTag}
							onClick={() => setFilterTag(null)}
						>
							{t("templatesPage.filter.all")}
						</Chip>
						{allTags.map((tag) => (
							<Chip
								key={tag}
								selected={filterTag === tag}
								onClick={() => setFilterTag(filterTag === tag ? null : tag)}
							>
								#{tag}
							</Chip>
						))}
					</div>
				)}
				{canCreate && !showCreate && (
					<ActionButton icon={<Plus size={16} aria-hidden />} type="button" className="ml-auto" onClick={() => setShowCreate(true)}>
						{t("templatesPage.action.create")}
					</ActionButton>
				)}
			</Toolbar>

			{showCreate && (
				<div ref={formPanelRef} className="mb-1 scroll-mt-24">
					<SurfacePanel title={editing ? t("templatesPage.edit.title", { name: editing.name }) : t("templatesPage.action.create")}>
						{/* Keyed by what is edited: opening another template starts from its own values. */}
						<TemplateForm
							key={editing?.id ?? "new"}
							template={editing ?? undefined}
							onClose={(saved) => {
								const edited = editing;
								setShowCreate(false);
								setEditing(null);
								if (!saved) return;
								addToast("success", edited ? t("templatesPage.toast.updated", { name: edited.name }) : t("templatesPage.toast.created"));
								void refresh();
							}}
						/>
					</SurfacePanel>
				</div>
			)}

			{filtered.length === 0 && filterTag && templates.length > 0 ? (
				// Templates exist and none carries the tag in the address (a bookmark, a tag since removed):
				// "no templates" over an unselected row of chips did not say why.
				<EmptyState
					icon={<IconFileCode size={20} />}
					variant="boxed"
					action={<ActionButton size="sm" variant="outline" onClick={() => setFilterTag(null)}>{t("templatesPage.filter.clear")}</ActionButton>}
				>
					{t("templatesPage.emptyForTag", { tag: filterTag })}
				</EmptyState>
			) : filtered.length === 0 ? (
				<EmptyState icon={<IconFileCode size={20} />} variant="boxed">
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
									<h3 className="ui-title-group">
										{tmpl.name}
									</h3>
									{tmpl.description && (
										<p className="mt-0.5 text-xs text-[var(--text-muted)]">
											{tmpl.description}
										</p>
									)}
								</div>
								{tmpl.isBuiltin && (
									<StatusBadge tone="accent" className="shrink-0 !rounded-lg !text-xs">
										{t("templatesPage.badge.builtin")}
									</StatusBadge>
								)}
							</div>
							{/* Clamp an inner block: clamping the padded box itself leaves a sliced
							    third line visible inside the bottom padding. */}
							<div data-inset className="mt-2.5 px-3 py-2 font-mono text-xs text-[var(--text-secondary)]" title={tmpl.command}>
								<span className="line-clamp-2 break-all">{tmpl.command}</span>
							</div>
							{tmpl.rollbackCommand && (
								<div
									className="ui-mono mt-2 rounded-md bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]"
									title={tmpl.rollbackCommand}
								>
									<span className="line-clamp-2 break-all">
										<span className="mr-2 font-sans text-xs text-[var(--success)]">
											{t("templatesPage.badge.rollback")}
										</span>
										{tmpl.rollbackCommand}
									</span>
								</div>
							)}
							{tmpl.variables.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-1">
									{tmpl.variables.map((v) => (
										<StatusBadge
											key={v}
											tone="warning"
											className="!rounded-lg font-mono !text-sm"
										>
											{`{{${v}}}`}
										</StatusBadge>
									))}
								</div>
							)}
							{tmpl.tags.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-1">
									{tmpl.tags.map((tag) => (
										<Badge key={tag}>
											#{tag}
										</Badge>
									))}
								</div>
							)}
							{/* At the card's foot, so the buttons of a row of cards line up whatever the command's length. */}
							<div className="mt-auto pt-3">
								<div className="flex items-center gap-2 border-t border-[var(--border)] pt-2">
									{canDeploy && (
										<DeployButton
											template={tmpl}
											servers={servers}
											onDeploy={handleDeploy}
											loading={deploying === tmpl.id}
										/>
									)}
									{canCreate && !tmpl.isBuiltin && (
										<ActionButton size="sm" variant="outline"
											onClick={() => { setEditing(tmpl); setShowCreate(true); }}
											disabled={showCreate}
											title={showCreate ? t("templatesPage.edit.busy") : undefined}>
											{t("templatesPage.edit.action")}
										</ActionButton>
									)}
									{canCreate && !tmpl.isBuiltin && (
										<ActionButton size="sm" variant="danger" onClick={() => { setDeleteError(null); setTemplatePendingDelete(tmpl); }}>
											{t("templatesPage.delete.action")}
										</ActionButton>
									)}
								</div>
							</div>
						</article>
					))}
				</div>
			)}
		</div>
	);
}
