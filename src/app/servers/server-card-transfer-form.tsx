"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ActionButton } from "@/components/action-button";
import { useToast } from "@/components/toast-provider";
import { FormField } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

type CustomerOption = { id: string; name: string };

/** Platform administrators move a server, with its storage and history, to another customer. */
export function ServerCardTransferForm({ serverId, serverName, currentTeamId }: {
	serverId: string;
	serverName: string;
	currentTeamId: string | null;
}) {
	const { t } = useI18n();
	const router = useRouter();
	const { addToast } = useToast();
	const [customers, setCustomers] = useState<CustomerOption[] | null>(null);
	const [targetId, setTargetId] = useState("");
	const [busy, setBusy] = useState(false);

	async function open() {
		setBusy(true);
		try {
			const data = await csrfFetch<{ teams: CustomerOption[] }>("/api/teams");
			setCustomers(data.teams.filter((customer) => customer.id !== currentTeamId));
		} catch (error) {
			addToast("error", getErrorMessage(error, t("serverCardActions.transfer.loadFailed")));
		} finally {
			setBusy(false);
		}
	}

	async function transfer() {
		const target = customers?.find((customer) => customer.id === targetId);
		if (!target) return;
		setBusy(true);
		try {
			await csrfFetch(`/api/servers/${encodeURIComponent(serverId)}/transfer`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ teamId: target.id }),
			});
			addToast("success", t("serverCardActions.transfer.done", { server: serverName, customer: target.name }));
			setCustomers(null);
			router.refresh();
		} catch (error) {
			addToast("error", getErrorMessage(error, t("serverCardActions.transfer.failed")));
		} finally {
			setBusy(false);
		}
	}

	if (!customers) {
		return (
			<ActionButton variant="ghost" className="w-full" onClick={() => void open()} disabled={busy}>
				{t("serverCardActions.transfer.open")}
			</ActionButton>
		);
	}
	return (
		<div data-inset="" className="space-y-2 p-3">
			<FormField label={t("serverCardActions.transfer.target")} htmlFor={`transfer-${serverId}`} hint={t("serverCardActions.transfer.hint")}>
				<select id={`transfer-${serverId}`} className={UI_INPUT} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
					<option value="">{t("serverCardActions.transfer.choose")}</option>
					{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
				</select>
			</FormField>
			<div className="flex gap-2">
				<ActionButton variant="primary" size="sm" onClick={() => void transfer()} disabled={busy || !targetId}>
					{t("serverCardActions.transfer.confirm")}
				</ActionButton>
				<ActionButton variant="ghost" size="sm" onClick={() => setCustomers(null)} disabled={busy}>
					{t("serverCardActions.transfer.cancel")}
				</ActionButton>
			</div>
		</div>
	);
}
