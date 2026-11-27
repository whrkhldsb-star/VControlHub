"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { ActionButton, ButtonLink } from "@/components/action-button";
import { Plus } from "@/components/icons";
import { EmptyState, ListPanel, ListRow, PageHeader, SurfacePanel } from "@/components/page-shell";
import { Dialog } from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { Badge, FormField, FormGrid, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useSessionGate } from "@/lib/auth/session-context";
import { useGateRoute } from "@/lib/auth/use-gate-route";
import {
	beginScopeSwitchRelease,
	endScopeSwitchRelease,
	finishScopeSwitchRelease,
	formatActiveWorkSummary,
	getActiveWorkSnapshot,
	subscribeActiveWork,
} from "@/lib/forms/active-work-guard";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";
import { notifyCustomersChanged } from "@/lib/team/customers-changed";
import { getErrorMessage } from "@/lib/http/error-message";
import { formatDate } from "@/lib/datetime/format";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { userCreateHref } from "@/lib/ui/deep-links";
import { useToast } from "@/components/toast-provider";
import { CustomerMembersDialog } from "./customer-members-dialog";
import { IdentityTemplatesSection } from "./identity-templates-section";

export type Customer = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	createdAt: string;
	deletedAt: string | null;
	_count: { members: number; servers: number; storageNodes: number };
};

type CustomerFields = { name: string; slug: string; description: string };

const EMPTY_FIELDS: CustomerFields = { name: "", slug: "", description: "" };
const CUSTOMER_FORM_ID = "customer-form";
const DELETE_FORM_ID = "customer-delete-form";

/** The form under the header: a new customer, or one being edited (opened filled in with what it holds). */
type FormState = { mode: "create" } | { mode: "edit"; customer: Customer };

function fieldsOf(customer: Customer): CustomerFields {
	return { name: customer.name, slug: customer.slug, description: customer.description ?? "" };
}

function sameFields(a: CustomerFields, b: CustomerFields): boolean {
	return a.name === b.name && a.slug === b.slug && a.description === b.description;
}

/** What an edit changes and nothing else: re-sent fields would be checked for a change nobody made. */
function changedFields(before: CustomerFields, after: CustomerFields): { name?: string; description?: string | null } {
	const changes: { name?: string; description?: string | null } = {};
	if (after.name.trim() !== before.name.trim()) changes.name = after.name.trim();
	if (after.description.trim() !== before.description.trim()) changes.description = after.description.trim() || null;
	return changes;
}

export function CustomersClient() {
	const { t, locale } = useI18n();
	const { addToast } = useToast();
	const router = useRouter();
	const { can } = useGateRoute();
	const { currentTeamId } = useSessionGate();
	// The next step after a new customer is an account for it, made on the users page by those who may.
	const canManageUsers = can("user:manage");
	const [customers, setCustomers] = useState<Customer[] | null>(null);
	const [deletedCustomers, setDeletedCustomers] = useState<Customer[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState<FormState | null>(null);
	const [fields, setFields] = useState<CustomerFields>(EMPTY_FIELDS);
	// Why the last create or edit was refused; said in the form that asked.
	const [formError, setFormError] = useState<string | null>(null);
	const [membersOf, setMembersOf] = useState<Customer | null>(null);
	const [deleting, setDeleting] = useState<Customer | null>(null);
	const [deleteConfirmName, setDeleteConfirmName] = useState("");
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// The customer just created: its next step is an account to sign in with, made on the users page.
	const [justCreated, setJustCreated] = useState<{ name: string; teamId: string | null } | null>(null);
	// What a reload of the workspace would end: deleting the customer being worked in switches out of it.
	const activeWork = useSyncExternalStore(subscribeActiveWork, getActiveWorkSnapshot, getActiveWorkSnapshot);

	const baseline = form?.mode === "edit" ? fieldsOf(form.customer) : EMPTY_FIELDS;
	const formDirty = form !== null && !sameFields(fields, baseline);
	const closeForm = useCallback(() => {
		setForm(null);
		setFields(EMPTY_FIELDS);
		setFormError(null);
	}, []);
	const { requestDiscard, discardDialog } = useUnsavedChangesGuard({ dirty: formDirty, onDiscard: closeForm });

	const load = useCallback(async () => {
		try {
			const data = await csrfFetch<{ teams: Customer[]; deletedTeams: Customer[] }>("/api/teams");
			setCustomers(data.teams);
			setDeletedCustomers(data.deletedTeams);
			setLoadError(null);
		} catch (error) {
			// A failed load is not an empty list: keep what was shown and offer a retry.
			setLoadError(getErrorMessage(error, t("customersPage.error.load")));
		}
	}, [t]);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- state lands in the async callback
		void load();
	}, [load]);

	function openCreate() {
		setForm({ mode: "create" });
		setFields(EMPTY_FIELDS);
		setFormError(null);
	}

	function openEdit(customer: Customer) {
		setForm({ mode: "edit", customer });
		setFields(fieldsOf(customer));
		setFormError(null);
	}

	async function afterChange() {
		await load();
		notifyCustomersChanged();
		router.refresh();
	}

	async function createCustomer() {
		const name = fields.name.trim();
		setSaving(true);
		setFormError(null);
		try {
			const data = await csrfFetch<{ team?: { id?: string } }>("/api/teams", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: fields.name, slug: fields.slug.trim() || undefined, description: fields.description || null }),
			});
			addToast("success", t("customersPage.created", { name }));
			setJustCreated({ name, teamId: data?.team?.id ?? null });
			closeForm();
			await afterChange();
		} catch (error) {
			setFormError(getErrorMessage(error, t("customersPage.error.create")));
		} finally {
			setSaving(false);
		}
	}

	async function updateCustomer(customer: Customer) {
		const changes = changedFields(fieldsOf(customer), fields);
		// Nothing changed: the form closes without asking the server anything.
		if (Object.keys(changes).length === 0) {
			closeForm();
			return;
		}
		setSaving(true);
		setFormError(null);
		try {
			await csrfFetch(`/api/teams/${encodeURIComponent(customer.id)}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(changes),
			});
			addToast("success", t("customersPage.updated", { name: changes.name ?? customer.name }));
			closeForm();
			await afterChange();
		} catch (error) {
			setFormError(getErrorMessage(error, t("customersPage.error.update")));
		} finally {
			setSaving(false);
		}
	}

	function submitForm(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!form || saving || !fields.name.trim()) return;
		if (form.mode === "edit") void updateCustomer(form.customer);
		else void createCustomer();
	}

	function openDelete(customer: Customer) {
		setDeleting(customer);
		setDeleteConfirmName("");
		setDeleteError(null);
	}

	function closeDelete() {
		if (busy) return;
		setDeleting(null);
		setDeleteError(null);
	}

	async function deleteCustomer(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!deleting || busy || deleteConfirmName.trim() !== deleting.name) return;
		// The customer being worked in: the server switches the session out of it and the workspace reloads. Its
		// guards step aside for that reload, as they do for a switch confirmed in the customer menu.
		const leavesScope = deleting.id === currentTeamId;
		setBusy(true);
		setDeleteError(null);
		if (leavesScope) beginScopeSwitchRelease();
		try {
			await csrfFetch(`/api/teams/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
			addToast("success", t("customersPage.deleted", { name: deleting.name }));
			setDeleting(null);
			await afterChange();
			if (leavesScope) finishScopeSwitchRelease();
		} catch (error) {
			if (leavesScope) endScopeSwitchRelease();
			// Said in the dialog that asked, which stays open.
			setDeleteError(getErrorMessage(error, t("customersPage.error.delete")));
		} finally {
			setBusy(false);
		}
	}

	async function restoreCustomer(customer: Customer) {
		setBusy(true);
		try {
			await csrfFetch(`/api/teams/${encodeURIComponent(customer.id)}/restore`, { method: "POST" });
			addToast("success", t("customersPage.restored", { name: customer.name }));
			await afterChange();
		} catch (error) {
			addToast("error", getErrorMessage(error, t("customersPage.error.restore")));
		} finally {
			setBusy(false);
		}
	}

	const editing = form?.mode === "edit" ? form.customer : null;
	const deletingCurrent = deleting !== null && deleting.id === currentTeamId;

	return (
		<div className="space-y-6">
			<PageHeader eyebrow={t("customersPage.eyebrow")} title={t("customersPage.title")} description={t("customersPage.description")}>
				{/* The command opens the form below and waits while it is open; the form has its own Cancel. */}
				{form === null ? (
					<ActionButton variant="primary" icon={<Plus size={16} aria-hidden />} onClick={openCreate}>
						{t("customersPage.create")}
					</ActionButton>
				) : null}
			</PageHeader>

			{form !== null && (
				<SurfacePanel
					title={editing ? t("customersPage.editTitle", { name: editing.name }) : t("customersPage.create")}
					description={editing ? undefined : t("customersPage.createHint")}
				>
					<form id={CUSTOMER_FORM_ID} onSubmit={submitForm} className="grid gap-4">
						{formError ? <Notice tone="danger" compact>{formError}</Notice> : null}
						<FormGrid>
							<FormField label={t("customersPage.field.name")} htmlFor="customer-name">
								<input disabled={saving} id="customer-name" value={fields.name} onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))} className={UI_INPUT} maxLength={80} required />
							</FormField>
							<FormField
								label={t("customersPage.field.slug")}
								htmlFor="customer-slug"
								hint={editing ? t("customersPage.field.slugLocked") : undefined}
							>
								<input disabled={saving || editing !== null} id="customer-slug" value={fields.slug} onChange={(e) => setFields((f) => ({ ...f, slug: e.target.value }))} placeholder={editing ? undefined : t("customersPage.field.slugPlaceholder")} className={UI_INPUT} maxLength={64} />
							</FormField>
							<FormField label={t("customersPage.field.description")} htmlFor="customer-description" className="md:col-span-2">
								<input disabled={saving} id="customer-description" value={fields.description} onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))} className={UI_INPUT} maxLength={300} />
							</FormField>
						</FormGrid>
						<div className="flex flex-wrap gap-3">
							<ActionButton type="submit" variant="primary" disabled={saving || !fields.name.trim()} loading={saving}>
								{editing ? t("common.saveChanges") : t("customersPage.create")}
							</ActionButton>
							<ActionButton type="button" variant="secondary" onClick={requestDiscard} disabled={saving}>
								{t("common.cancel")}
							</ActionButton>
						</div>
					</form>
				</SurfacePanel>
			)}
			{discardDialog}

			{justCreated ? (
				<Notice tone="success" onDismiss={() => setJustCreated(null)} dismissLabel={t("common.close")}>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<span>{t("customersPage.nextStep.text", { name: justCreated.name })}</span>
						{canManageUsers ? (
							<ButtonLink href={userCreateHref(justCreated.teamId)} size="sm" variant="secondary">
								{t("customersPage.nextStep.action", { name: justCreated.name })}
							</ButtonLink>
						) : null}
					</div>
				</Notice>
			) : null}

			{loadError && <Notice tone="danger" action={{ label: t("common.retry"), onClick: () => void load() }}>{loadError}</Notice>}

			<ListPanel
				title={t("customersPage.listTitle")}
				count={customers === null ? "…" : customers.length}
				empty={customers !== null && customers.length === 0 ? (
					<EmptyState
						title={t("customersPage.empty")}
						text={t("customersPage.emptyHint")}
						action={form !== null ? undefined : (
							<ActionButton size="sm" variant="primary" icon={<Plus size={14} aria-hidden />} onClick={openCreate}>
								{t("customersPage.create")}
							</ActionButton>
						)}
					/>
				) : undefined}
			>
				{(customers ?? []).map((customer) => (
					<ListRow key={customer.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<span className="whitespace-pre-wrap break-words font-medium text-[var(--text-primary)]">{customer.name}</span>
								<span className="text-xs text-[var(--text-muted)]">{customer.slug}</span>
							</div>
							{customer.description && <p className="mt-1 text-xs text-[var(--text-secondary)]">{customer.description}</p>}
							<div className="mt-2 flex flex-wrap gap-1.5 text-xs">
								<Badge tone="neutral">{t("customersPage.count.members", { count: customer._count.members })}</Badge>
								<Badge tone="neutral">{t("customersPage.count.servers", { count: customer._count.servers })}</Badge>
								<Badge tone="neutral">{t("customersPage.count.storage", { count: customer._count.storageNodes })}</Badge>
								<span className="text-[var(--text-muted)]">{t("customersPage.createdAt", { date: formatDate(customer.createdAt, locale) })}</span>
							</div>
						</div>
						<div className="flex shrink-0 flex-wrap gap-2">
							{/* While a form is open, the list's edit waits for it. */}
							<ActionButton size="sm" variant="secondary" onClick={() => openEdit(customer)} disabled={form !== null}>{t("common.edit")}</ActionButton>
							<ActionButton size="sm" variant="outline" onClick={() => setMembersOf(customer)}>{t("customersPage.action.members")}</ActionButton>
							<ActionButton size="sm" variant="danger" onClick={() => openDelete(customer)}>{t("customersPage.action.delete")}</ActionButton>
						</div>
					</ListRow>
				))}
			</ListPanel>

			{deletedCustomers.length > 0 && (
				<Disclosure title={t("customersPage.deletedTitle")} count={deletedCustomers.length} description={t("customersPage.deletedHint")}>
					<ul className="divide-y divide-[var(--border-subtle)]">
						{deletedCustomers.map((customer) => (
							<li key={customer.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
								<div className="min-w-0 text-sm">
									<span className="whitespace-pre-wrap break-words font-medium text-[var(--text-primary)]">{customer.name}</span>
									<span className="ml-2 text-xs text-[var(--text-muted)]">
										{t("customersPage.deletedAt", { date: formatDate(customer.deletedAt!, locale) })} · {t("customersPage.count.servers", { count: customer._count.servers })}
									</span>
								</div>
								<ActionButton size="sm" variant="secondary" onClick={() => restoreCustomer(customer)} disabled={busy}>{t("customersPage.action.restore")}</ActionButton>
							</li>
						))}
					</ul>
				</Disclosure>
			)}

			<IdentityTemplatesSection />

			{membersOf && <CustomerMembersDialog customer={membersOf} onClose={() => setMembersOf(null)} onChanged={load} />}

			{deleting && (
				<Dialog
					open
					onClose={closeDelete}
					busy={busy}
					title={t("customersPage.deleteTitle", { name: deleting.name })}
					closeLabel={t("common.close")}
					footer={<>
						<ActionButton type="button" variant="secondary" onClick={closeDelete} disabled={busy}>{t("common.cancel")}</ActionButton>
						<ActionButton type="submit" form={DELETE_FORM_ID} variant="danger-solid" loading={busy} disabled={deleteConfirmName.trim() !== deleting.name}>
							{t("customersPage.action.delete")}
						</ActionButton>
					</>}
				>
					<form id={DELETE_FORM_ID} onSubmit={deleteCustomer} className="space-y-3 text-sm text-[var(--text-secondary)]">
						<p>{t("customersPage.deleteImpact", { members: deleting._count.members, servers: deleting._count.servers, storage: deleting._count.storageNodes })}</p>
						<p>{t("customersPage.deleteRestorable")}</p>
						{deletingCurrent && activeWork.hasAny ? (
							<Notice tone="warning" title={t("customersPage.deleteCurrent.title")}>
								{t("customersPage.deleteCurrent.activeWork", { items: formatActiveWorkSummary(activeWork, t) })}
							</Notice>
						) : null}
						<FormField label={<span className="whitespace-pre-wrap break-words">{t("customersPage.deleteTypeName", { name: deleting.name })}</span>} htmlFor="customer-delete-confirm">
							<input id="customer-delete-confirm" value={deleteConfirmName} onChange={(e) => { setDeleteConfirmName(e.target.value); setDeleteError(null); }} className={UI_INPUT} autoComplete="off" disabled={busy} />
						</FormField>
						{deleteError ? <Notice tone="danger" compact>{deleteError}</Notice> : null}
					</form>
				</Dialog>
			)}
		</div>
	);
}
