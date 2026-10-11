"use client";

import { useCallback, useEffect, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { Plus } from "@/components/icons";
import { EmptyState, ListPanel, ListRow } from "@/components/page-shell";
import { Dialog } from "@/components/ui/dialog";
import { Badge, FormField, FormGrid, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { CUSTOMER_PERMISSIONS, identityTemplateName } from "@/lib/auth/identity-templates";
import { groupPermissionsByDomain, permissionLabelKey } from "@/lib/auth/permission-labels";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

type IdentityTemplate = {
	id: string;
	name: string;
	description: string | null;
	permissions: string[];
	isBuiltin: boolean;
	_count: { members: number };
};

type Draft = { id: string | null; name: string; description: string; permissions: string[]; readOnly: boolean };

const PERMISSION_GROUPS = groupPermissionsByDomain(CUSTOMER_PERMISSIONS);

export function IdentityTemplatesSection() {
	const { t } = useI18n();
	const [templates, setTemplates] = useState<IdentityTemplate[] | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			setTemplates((await csrfFetch<{ templates: IdentityTemplate[] }>("/api/identity-templates")).templates);
		} catch (err) {
			setError(getErrorMessage(err, t("identityTemplatesPage.error.load")));
			setTemplates([]);
		}
	}, [t]);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- state lands in the async callback
		void load();
	}, [load]);

	const open = (template: IdentityTemplate | null) => {
		setError(null);
		setDraft(template
			? { id: template.id, name: identityTemplateName(template, t), description: template.description ?? "", permissions: template.permissions, readOnly: template.isBuiltin }
			: { id: null, name: "", description: "", permissions: [], readOnly: false });
	};

	async function save() {
		if (!draft || draft.readOnly) return;
		setBusy(true);
		setError(null);
		try {
			await csrfFetch(draft.id ? `/api/identity-templates/${encodeURIComponent(draft.id)}` : "/api/identity-templates", {
				method: draft.id ? "PATCH" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: draft.name, description: draft.description || null, permissions: draft.permissions }),
			});
			setDraft(null);
			await load();
		} catch (err) {
			setError(getErrorMessage(err, t("identityTemplatesPage.error.save")));
		} finally {
			setBusy(false);
		}
	}

	async function remove(template: IdentityTemplate) {
		setBusy(true);
		setError(null);
		try {
			await csrfFetch(`/api/identity-templates/${encodeURIComponent(template.id)}`, { method: "DELETE" });
			await load();
		} catch (err) {
			setError(getErrorMessage(err, t("identityTemplatesPage.error.delete")));
		} finally {
			setBusy(false);
		}
	}

	const toggle = (permission: string) => setDraft((current) => current && {
		...current,
		permissions: current.permissions.includes(permission)
			? current.permissions.filter((item) => item !== permission)
			: [...current.permissions, permission],
	});

	return (
		<>
			{error && !draft && <Notice tone="danger">{error}</Notice>}
			<ListPanel
				title={t("identityTemplatesPage.title")}
				description={t("identityTemplatesPage.description")}
				count={templates === null ? "…" : templates.length}
				actions={<ActionButton size="sm" variant="primary" icon={<Plus size={14} aria-hidden />} onClick={() => open(null)}>{t("identityTemplatesPage.create")}</ActionButton>}
				empty={templates !== null && templates.length === 0 ? <EmptyState>{t("identityTemplatesPage.empty")}</EmptyState> : undefined}
			>
				{(templates ?? []).map((template) => (
					<ListRow key={template.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-medium text-[var(--text-primary)]">{identityTemplateName(template, t)}</span>
								{template.isBuiltin && <Badge tone="neutral">{t("identityTemplatesPage.builtin")}</Badge>}
							</div>
							<p className="mt-1 text-xs text-[var(--text-muted)]">
								{t("identityTemplatesPage.summary", { permissions: template.permissions.length, members: template._count.members })}
							</p>
						</div>
						<div className="flex shrink-0 gap-2">
							<ActionButton size="sm" variant="outline" onClick={() => open(template)}>
								{template.isBuiltin ? t("identityTemplatesPage.view") : t("identityTemplatesPage.edit")}
							</ActionButton>
							{!template.isBuiltin && (
								<ActionButton size="sm" variant="danger" disabled={busy || template._count.members > 0} onClick={() => void remove(template)}
									title={template._count.members > 0 ? t("identityTemplatesPage.inUse") : undefined}>
									{t("identityTemplatesPage.delete")}
								</ActionButton>
							)}
						</div>
					</ListRow>
				))}
			</ListPanel>

			{draft && (
				<Dialog
					open
					size="lg"
					onClose={() => setDraft(null)}
					busy={busy}
					title={draft.id ? draft.name : t("identityTemplatesPage.create")}
					description={draft.readOnly ? t("identityTemplatesPage.builtinReadOnly") : undefined}
					closeLabel={t("common.close")}
					footer={<>
						<ActionButton variant="secondary" onClick={() => setDraft(null)}>{draft.readOnly ? t("common.close") : t("common.cancel")}</ActionButton>
						{!draft.readOnly && (
							<ActionButton variant="primary" onClick={save} loading={busy} disabled={busy || !draft.name.trim() || draft.permissions.length === 0}>
								{t("identityTemplatesPage.save")}
							</ActionButton>
						)}
					</>}
				>
					<div className="space-y-4">
						{error && <Notice tone="danger" compact>{error}</Notice>}
						{!draft.readOnly && (
							<FormGrid>
								<FormField label={t("identityTemplatesPage.field.name")} htmlFor="identity-template-name">
									<input id="identity-template-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={UI_INPUT} maxLength={120} />
								</FormField>
								<FormField label={t("identityTemplatesPage.field.description")} htmlFor="identity-template-description">
									<input id="identity-template-description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={UI_INPUT} maxLength={300} />
								</FormField>
							</FormGrid>
						)}
						{PERMISSION_GROUPS.map((group) => (
							<fieldset key={group.domain} className="min-w-0">
								<legend className="ui-label mb-2">{t(group.labelKey)}</legend>
								<div className="grid gap-2 sm:grid-cols-2">
									{group.permissions.map((permission) => (
										<label key={permission} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]" title={permission}>
											<input type="checkbox" className="mt-1" checked={draft.permissions.includes(permission)} disabled={draft.readOnly} onChange={() => toggle(permission)} />
											<span>{t(permissionLabelKey(permission))}</span>
										</label>
									))}
								</div>
							</fieldset>
						))}
					</div>
				</Dialog>
			)}
		</>
	);
}
