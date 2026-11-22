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
	const { t, locale } = useI18n();
	const router = useRouter();
	const { addToast } = useToast();
	const [customers, setCustomers] = useState<CustomerOption[] | null>(null);
	const [targetId, setTargetId] = useState("");
	const [fileAgentStopped, setFileAgentStopped] = useState(false);
	const [credentialsRotated, setCredentialsRotated] = useState(false);
	const [busy, setBusy] = useState(false);

	async function open() {
		setCredentialsRotated(false);
		setFileAgentStopped(false);
		setTargetId("");
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
		if (!target || !credentialsRotated) return;
		setBusy(true);
		try {
			await csrfFetch(`/api/servers/${encodeURIComponent(serverId)}/transfer`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ teamId: target.id, previousTeamId: currentTeamId, credentialsRotated, fileAgentStopped }),
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
			<label className="flex items-start gap-2" htmlFor={`credentials-rotated-${serverId}`}>
				<input id={`credentials-rotated-${serverId}`} type="checkbox" checked={credentialsRotated}
					onChange={event => setCredentialsRotated(event.target.checked)} />
				{locale === "en" ? "I verified that the previous customer’s SSH, RDP and service credentials have been rotated or disabled on the host, including stored service configuration."
					: "我已核实原客户的 SSH、RDP 和服务凭据已在远端轮换或停用，并已更新保存的服务配置。"}
			</label>
			<label className="flex items-start gap-2" htmlFor={`file-agent-stopped-${serverId}`}>
				<input id={`file-agent-stopped-${serverId}`} type="checkbox" checked={fileAgentStopped}
					onChange={event => setFileAgentStopped(event.target.checked)} />
				{locale === "en" ? "For a lost file receipt only: I verified the old file Agent has stopped and cannot restart."
					: "仅用于文件回执丢失的情况：我已核实旧文件 Agent 已停止运行，并已禁止重启。"}
			</label>
			<div className="flex gap-2">
				<ActionButton variant="primary" size="sm" onClick={() => void transfer()} disabled={busy || !targetId || !credentialsRotated}>
					{t("serverCardActions.transfer.confirm")}
				</ActionButton>
				<ActionButton variant="ghost" size="sm" onClick={() => setCustomers(null)} disabled={busy}>
					{t("serverCardActions.transfer.cancel")}
				</ActionButton>
			</div>
		</div>
	);
}
