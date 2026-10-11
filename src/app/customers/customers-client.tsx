"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ActionButton } from "@/components/action-button";
import { Plus } from "@/components/icons";
import { EmptyState, ListPanel, ListRow, PageHeader, SurfacePanel } from "@/components/page-shell";
import { Dialog } from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { Badge, FormField, FormGrid, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { notifyCustomersChanged } from "@/lib/team/customers-changed";
import { getErrorMessage } from "@/lib/http/error-message";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
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

export function CustomersClient() {
	const { t, locale } = useI18n();
	const { addToast } = useToast();
	const router = useRouter();
	const [customers, setCustomers] = useState<Customer[] | null>(null);
	const [deletedCustomers, setDeletedCustomers] = useState<Customer[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [form, setForm] = useState({ name: "", slug: "", description: "" });
	const [showCreate, setShowCreate] = useState(false);
	const [membersOf, setMembersOf] = useState<Customer | null>(null);
	const [deleting, setDeleting] = useState<Customer | null>(null);
	const [deleteConfirmName, setDeleteConfirmName] = useState("");
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			const data = await csrfFetch<{ teams: Customer[]; deletedTeams: Customer[] }>("/api/teams");
			setCustomers(data.teams);
			setDeletedCustomers(data.deletedTeams);
			setLoadError(null);
		} catch (error) {
			setLoadError(getErrorMessage(error, t("customersPage.error.load")));
			setCustomers([]);
		}
	}, [t]);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- state lands in the async callback
		void load();
	}, [load]);

	async function createCustomer() {
		if (!form.name.trim()) return;
		setCreating(true);
		try {
			await csrfFetch("/api/teams", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: form.name, slug: form.slug.trim() || undefined, description: form.description || null }),
			});
			addToast("success", t("customersPage.created", { name: form.name.trim() }));
			setForm({ name: "", slug: "", description: "" });
			setShowCreate(false);
			await load();
			notifyCustomersChanged();
			router.refresh();
		} catch (error) {
			addToast("error", getErrorMessage(error, t("customersPage.error.create")));
		} finally {
			setCreating(false);
		}
	}

	async function deleteCustomer() {
		if (!deleting || deleteConfirmName.trim() !== deleting.name) return;
		setBusy(true);
		try {
			await csrfFetch(`/api/teams/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
			addToast("success", t("customersPage.deleted", { name: deleting.name }));
			setDeleting(null);
			await load();
			notifyCustomersChanged();
			router.refresh();
		} catch (error) {
			addToast("error", getErrorMessage(error, t("customersPage.error.delete")));
		} finally {
			setBusy(false);
		}
	}

	async function restoreCustomer(customer: Customer) {
		setBusy(true);
		try {
			await csrfFetch(`/api/teams/${encodeURIComponent(customer.id)}/restore`, { method: "POST" });
			addToast("success", t("customersPage.restored", { name: customer.name }));
			await load();
			notifyCustomersChanged();
			router.refresh();
		} catch (error) {
			addToast("error", getErrorMessage(error, t("customersPage.error.restore")));
		} finally {
			setBusy(false);
		}
	}

	const formatDate = (value: string) => new Date(value).toLocaleDateString(toDateLocale(locale));

	return (
		<div className="space-y-6">
			<PageHeader eyebrow={t("customersPage.eyebrow")} title={t("customersPage.title")} description={t("customersPage.description")}>
				<ActionButton
					variant={showCreate ? "secondary" : "primary"}
					icon={showCreate ? undefined : <Plus size={16} aria-hidden />}
					onClick={() => setShowCreate((open) => !open)}
				>
					{showCreate ? t("common.cancel") : t("customersPage.create")}
				</ActionButton>
			</PageHeader>

			{showCreate && (
				<SurfacePanel title={t("customersPage.create")} description={t("customersPage.createHint")}>
					<FormGrid>
						<FormField label={t("customersPage.field.name")} htmlFor="customer-name">
							<input id="customer-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={UI_INPUT} maxLength={80} />
						</FormField>
						<FormField label={t("customersPage.field.slug")} htmlFor="customer-slug">
							<input id="customer-slug" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder={t("customersPage.field.slugPlaceholder")} className={UI_INPUT} maxLength={64} />
						</FormField>
						<FormField label={t("customersPage.field.description")} htmlFor="customer-description" className="md:col-span-2">
							<input id="customer-description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={UI_INPUT} maxLength={300} />
						</FormField>
					</FormGrid>
					<ActionButton variant="primary" onClick={createCustomer} disabled={creating || !form.name.trim()} loading={creating}>
						{t("customersPage.create")}
					</ActionButton>
				</SurfacePanel>
			)}

			{loadError && <Notice tone="danger">{loadError}</Notice>}

			<ListPanel
				title={t("customersPage.listTitle")}
				count={customers === null ? "…" : customers.length}
				empty={customers !== null && customers.length === 0 ? <EmptyState>{t("customersPage.empty")}</EmptyState> : undefined}
			>
				{(customers ?? []).map((customer) => (
					<ListRow key={customer.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-medium text-[var(--text-primary)]">{customer.name}</span>
								<span className="text-xs text-[var(--text-muted)]">{customer.slug}</span>
							</div>
							{customer.description && <p className="mt-1 text-xs text-[var(--text-secondary)]">{customer.description}</p>}
							<div className="mt-2 flex flex-wrap gap-1.5 text-xs">
								<Badge tone="neutral">{t("customersPage.count.members", { count: customer._count.members })}</Badge>
								<Badge tone="neutral">{t("customersPage.count.servers", { count: customer._count.servers })}</Badge>
								<Badge tone="neutral">{t("customersPage.count.storage", { count: customer._count.storageNodes })}</Badge>
								<span className="text-[var(--text-muted)]">{t("customersPage.createdAt", { date: formatDate(customer.createdAt) })}</span>
							</div>
						</div>
						<div className="flex shrink-0 flex-wrap gap-2">
							<ActionButton size="sm" variant="outline" onClick={() => setMembersOf(customer)}>{t("customersPage.action.members")}</ActionButton>
							<ActionButton size="sm" variant="danger" onClick={() => { setDeleting(customer); setDeleteConfirmName(""); }}>{t("customersPage.action.delete")}</ActionButton>
						</div>
					</ListRow>
				))}
			</ListPanel>

			{deletedCustomers.length > 0 && (
				<Disclosure title={t("customersPage.deletedTitle", { count: deletedCustomers.length })} description={t("customersPage.deletedHint")}>
					<ul className="divide-y divide-[var(--border-subtle)]">
						{deletedCustomers.map((customer) => (
							<li key={customer.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
								<div className="min-w-0 text-sm">
									<span className="font-medium text-[var(--text-primary)]">{customer.name}</span>
									<span className="ml-2 text-xs text-[var(--text-muted)]">
										{t("customersPage.deletedAt", { date: formatDate(customer.deletedAt!) })} · {t("customersPage.count.servers", { count: customer._count.servers })}
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
					onClose={() => setDeleting(null)}
					busy={busy}
					title={t("customersPage.deleteTitle", { name: deleting.name })}
					closeLabel={t("common.close")}
					footer={<>
						<ActionButton variant="secondary" onClick={() => setDeleting(null)}>{t("common.cancel")}</ActionButton>
						<ActionButton variant="danger-solid" onClick={deleteCustomer} disabled={busy || deleteConfirmName.trim() !== deleting.name}>
							{t("customersPage.action.delete")}
						</ActionButton>
					</>}
				>
					<div className="space-y-3 text-sm text-[var(--text-secondary)]">
						<p>{t("customersPage.deleteImpact", { members: deleting._count.members, servers: deleting._count.servers, storage: deleting._count.storageNodes })}</p>
						<p>{t("customersPage.deleteRestorable")}</p>
						<FormField label={t("customersPage.deleteTypeName", { name: deleting.name })} htmlFor="customer-delete-confirm">
							<input id="customer-delete-confirm" value={deleteConfirmName} onChange={(e) => setDeleteConfirmName(e.target.value)} className={UI_INPUT} autoComplete="off" />
						</FormField>
					</div>
				</Dialog>
			)}
		</div>
	);
}
