"use client";

import { useCallback, useEffect, useState } from "react";

import { ActionButton, ButtonLink } from "@/components/action-button";
import { EmptyState } from "@/components/page-shell";
import { Dialog } from "@/components/ui/dialog";
import { InlineLoading, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { identityTemplateName } from "@/lib/auth/identity-templates";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import type { Customer } from "./customers-client";

type TemplateOption = { id: string; name: string; isBuiltin: boolean };
type Member = {
	joinedAt: string;
	identityTemplate: TemplateOption;
	user: { id: string; username: string; displayName: string | null; status: string };
};
type UnassignedAccount = { id: string; username: string; displayName: string | null };

export function CustomerMembersDialog({ customer, onClose, onChanged }: { customer: Customer; onClose: () => void; onChanged: () => void }) {
	const { t } = useI18n();
	const [members, setMembers] = useState<Member[] | null>(null);
	const [templates, setTemplates] = useState<TemplateOption[]>([]);
	const [unassigned, setUnassigned] = useState<UnassignedAccount[]>([]);
	const [addUserId, setAddUserId] = useState("");
	const [addTemplateId, setAddTemplateId] = useState("identity:viewer");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
	const base = `/api/teams/${encodeURIComponent(customer.id)}/members`;

	const load = useCallback(async () => {
		try {
			const [memberData, templateData, userData] = await Promise.all([
				csrfFetch<{ members: Member[] }>(base),
				csrfFetch<{ templates: TemplateOption[] }>("/api/identity-templates"),
				csrfFetch<{ users: Array<UnassignedAccount & { accountType: string; customer: unknown }> }>("/api/users?pageSize=100"),
			]);
			setMembers(memberData.members);
			setTemplates(templateData.templates);
			const free = userData.users.filter((user) => user.accountType === "customer" && !user.customer);
			setUnassigned(free);
			setAddUserId((current) => current || free[0]?.id || "");
		} catch (error) {
			setMessage({ tone: "danger", text: getErrorMessage(error, t("customersPage.error.members")) });
			setMembers([]);
		}
	}, [base, t]);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- state lands in the async callback
		void load();
	}, [load]);

	async function run(action: () => Promise<unknown>, success: string) {
		setBusy(true);
		setMessage(null);
		try {
			await action();
			setMessage({ tone: "success", text: success });
			await load();
			onChanged();
		} catch (error) {
			setMessage({ tone: "danger", text: getErrorMessage(error, t("customersPage.error.members")) });
		} finally {
			setBusy(false);
		}
	}

	const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

	return (
		<Dialog
			open
			size="lg"
			onClose={onClose}
			busy={busy}
			eyebrow={customer.name}
			title={t("customersPage.membersTitle")}
			description={t("customersPage.membersHint")}
			closeLabel={t("common.close")}
			footer={<ActionButton variant="secondary" onClick={onClose}>{t("common.close")}</ActionButton>}
		>
			<div className="space-y-5">
				{message && <Notice tone={message.tone} compact>{message.text}</Notice>}
				{members === null ? <InlineLoading label={t("common.loading")} /> : members.length === 0 ? (
					<EmptyState>{t("customersPage.noMembers")}</EmptyState>
				) : (
					<ul className="divide-y divide-[var(--border-subtle)]">
						{members.map((member) => (
							<li key={member.user.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
								<div className="min-w-0 text-sm">
									<span className="font-medium text-[var(--text-primary)]">{member.user.displayName ?? member.user.username}</span>
									<span className="ml-2 text-xs text-[var(--text-muted)]">@{member.user.username}</span>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<select
										aria-label={t("usersPerm.account.template")}
										value={member.identityTemplate.id}
										disabled={busy}
										onChange={(event) => void run(
											() => csrfFetch(`${base}/${encodeURIComponent(member.user.id)}`, json("PATCH", { identityTemplateId: event.target.value })),
											t("customersPage.memberUpdated", { name: member.user.username }),
										)}
										className={cn(UI_INPUT, "w-auto min-h-9 text-sm")}
									>
										{templates.map((template) => <option key={template.id} value={template.id}>{identityTemplateName(template, t)}</option>)}
									</select>
									<ActionButton size="sm" variant="danger" disabled={busy} onClick={() => void run(
										() => csrfFetch(`${base}/${encodeURIComponent(member.user.id)}`, { method: "DELETE" }),
										t("customersPage.memberRemoved", { name: member.user.username }),
									)}>{t("customersPage.action.removeMember")}</ActionButton>
								</div>
							</li>
						))}
					</ul>
				)}

				<section data-inset className="space-y-3 p-4">
					<h4 className="ui-title-group">{t("customersPage.addMember")}</h4>
					{unassigned.length === 0 ? (
						<p className="text-xs text-[var(--text-muted)]">{t("customersPage.noUnassigned")}</p>
					) : (
						<div className="flex flex-wrap items-center gap-2">
							<select aria-label={t("customersPage.addMemberAccount")} value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className={cn(UI_INPUT, "w-auto min-h-9 text-sm")}>
								{unassigned.map((user) => <option key={user.id} value={user.id}>{user.displayName ?? user.username} (@{user.username})</option>)}
							</select>
							<select aria-label={t("usersPerm.account.template")} value={addTemplateId} onChange={(e) => setAddTemplateId(e.target.value)} className={cn(UI_INPUT, "w-auto min-h-9 text-sm")}>
								{templates.map((template) => <option key={template.id} value={template.id}>{identityTemplateName(template, t)}</option>)}
							</select>
							<ActionButton size="sm" variant="primary" disabled={busy || !addUserId} onClick={() => void run(
								() => csrfFetch(base, json("POST", { userId: addUserId, identityTemplateId: addTemplateId })),
								t("customersPage.memberAdded"),
							)}>{t("customersPage.action.addMember")}</ActionButton>
						</div>
					)}
					<ButtonLink href="/users" size="sm" variant="secondary">{t("customersPage.createAccount")}</ButtonLink>
				</section>
			</div>
		</Dialog>
	);
}
