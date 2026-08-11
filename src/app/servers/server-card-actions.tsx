"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";

import {
	deleteServerAction,
	toggleServerAction,
	updateServerAction,
	type ServerActionState,
} from "./actions";
import { ServerCardDirectGatewayForm } from "./server-card-actions-direct-gateway";
import { ServerCardDeleteForm } from "./server-card-delete-form";
import { ServerCardEditForm } from "./server-card-edit-form";
import { useSshTerminal } from "./ssh-terminal-context";
import { ActionButton } from "@/components/action-button";

const initialState: ServerActionState = {
	error: undefined,
	success: undefined,
	relatedStorageCount: undefined,
};

type ServerCardActionsProps = {
	serverId: string;
	serverName: string;
	host: string;
	port: number;
	enabled: boolean;
	sessionToken: string;
	username?: string;
	connectionType?: "SSH_KEY" | "PASSWORD";
	managementMode?: "DIRECT" | "AGENT";
	hasSshCredential?: boolean;
	description?: string | null;
	tags?: string[] | null;
	costAutoSync?: boolean;
	costMonthlyAmount?: string | null;
	costCurrency?: "CNY" | "USD" | "EUR" | "JPY" | "HKD";
	costProvider?: string | null;
	costLastSyncedAt?: string | null;
	storagePath?: string | null;
	storageNodeId?: string | null;
	canManageServers?: boolean;
	canUseSshTerminal?: boolean;
	onSshConnect?: () => void;
	directGateway?: {
		enabled: boolean;
		statusLabel: string;
		publicUrl: string | null;
		port: number;
	};
};

export function ServerCardActions({
	serverId,
	serverName,
	host,
	port,
	enabled,
	sessionToken,
	username = "root",
	connectionType = "PASSWORD",
	managementMode = "DIRECT",
	hasSshCredential = true,
	description = "",
	tags = [],
	costAutoSync = false,
	costMonthlyAmount = null,
	costCurrency = "CNY",
	costProvider = null,
	costLastSyncedAt = null,
	storagePath = null,
	storageNodeId = null,
	canManageServers = true,
	canUseSshTerminal = false,
	onSshConnect,
	directGateway,
}: ServerCardActionsProps) {
	const { t } = useI18n();
	const router = useRouter();
	const [toggleState, toggleAction] = useActionState(toggleServerAction, initialState);
	const [deleteState, deleteAction] = useActionState(deleteServerAction, initialState);
	const [editState, editAction] = useActionState(updateServerAction, initialState);
	const [showEdit, setShowEdit] = useState(false);
	const { openTerminal } = useSshTerminal();

	useEffect(() => {
		if (toggleState.success) router.refresh();
	}, [toggleState.success, router]);

	useEffect(() => {
		if (deleteState.success) router.refresh();
	}, [deleteState.success, router]);

	useEffect(() => {
		if (editState.success) router.refresh();
	}, [editState.success, router]);

	const handleOpenTerminal = () => {
		onSshConnect?.();
		openTerminal({
			serverId,
			serverName,
			host: `${host}:${port}`,
			sessionToken,
		});
	};

	return (
		<div className="space-y-3">
			{enabled && canUseSshTerminal ? (
				<ActionButton variant="ghost"
					onClick={handleOpenTerminal}
					aria-label={t("serverCardActions.sshTerminalAria", { name: serverName })}
				
					data-tone="cyan"
					className="flex w-full items-center justify-center gap-2"
				>
					<span aria-hidden="true">💻</span>
					<span>{t("serverCardActions.sshTerminalButton")}</span>
				</ActionButton>
			) : null}

			{canManageServers && directGateway ? (
				<ServerCardDirectGatewayForm serverId={serverId} directGateway={directGateway} />
			) : null}

			{canManageServers ? (
				<ActionButton variant="secondary"
					onClick={() => setShowEdit((value) => !value)}
				
					className="w-full"
				>
					{showEdit
						? t("serverCardActions.edit.toggleHide")
						: t("serverCardActions.edit.toggleShow")}
				</ActionButton>
			) : null}

			{canManageServers && showEdit ? (
				<ServerCardEditForm
					serverId={serverId}
					serverName={serverName}
					host={host}
					port={port}
					username={username}
					connectionType={connectionType}
					managementMode={managementMode}
					hasSshCredential={hasSshCredential}
					description={description}
					tags={tags}
					costAutoSync={costAutoSync}
					costMonthlyAmount={costMonthlyAmount}
					costCurrency={costCurrency}
					costProvider={costProvider}
					costLastSyncedAt={costLastSyncedAt}
					storagePath={storagePath}
					storageNodeId={storageNodeId}
					editAction={editAction}
					editState={editState}
				/>
			) : null}

				{canManageServers ? (
					<form action={toggleAction} className="space-y-2">
						<input type="hidden" name="serverId" value={serverId} />
						{!enabled && toggleState.hostKeySha256 ? (
							<div className="space-y-2 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-xs text-[var(--text-secondary)]">
								<p className="font-medium text-[var(--text-primary)]">{t("serverCardActions.toggle.hostKeyTitle")}</p>
								<p>{t("serverCardActions.toggle.hostKeyDesc")}</p>
								<code className="block break-all rounded-lg border border-[var(--warning-border)] bg-[var(--input-bg)] px-3 py-2 text-[var(--text-primary)]">
									{toggleState.hostKeySha256}
								</code>
								<input type="hidden" name="approvedHostKeySha256" value={toggleState.hostKeySha256} />
								<label className="flex items-start gap-2 text-[var(--text-primary)]">
									<input type="checkbox" required className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
									<span>{t("serverCardActions.toggle.hostKeyConfirm")}</span>
								</label>
							</div>
						) : null}
						<SubmitButton
						pendingLabel={t("serverCardActions.toggle.pending")}
						variant="ghost"
						className="w-full"
					>
							{!enabled && toggleState.hostKeySha256
								? t("serverCardActions.toggle.confirmAndEnable")
								: enabled
								? t("serverCardActions.toggle.disable")
								: t("serverCardActions.toggle.enable")}
					</SubmitButton>
						{toggleState.error && !toggleState.hostKeySha256 ? (
						<div role="alert" className="text-xs text-[var(--danger)]">
							{toggleState.error}
						</div>
					) : null}
					{toggleState.success ? (
						<div role="status" className="text-xs text-[var(--success)]">
							{toggleState.success}
						</div>
					) : null}
				</form>
			) : null}

			{canManageServers ? (
				<ServerCardDeleteForm
					serverId={serverId}
					serverName={serverName}
					deleteAction={deleteAction}
					deleteState={deleteState}
				/>
			) : null}
		</div>
	);
}
