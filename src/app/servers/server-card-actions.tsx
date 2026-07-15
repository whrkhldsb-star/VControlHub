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
	description?: string | null;
	tags?: string[] | null;
	costAutoSync?: boolean;
	costMonthlyAmount?: string | null;
	costCurrency?: "CNY" | "USD" | "EUR" | "JPY" | "HKD";
	costProvider?: string | null;
	costLastSyncedAt?: string | null;
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
	description = "",
	tags = [],
	costAutoSync = false,
	costMonthlyAmount = null,
	costCurrency = "CNY",
	costProvider = null,
	costLastSyncedAt = null,
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
				<button
					type="button"
					onClick={handleOpenTerminal}
					aria-label={t("serverCardActions.sshTerminalAria").replace("{name}", serverName)}
					data-action-button
					data-variant="ghost"
					data-tone="cyan"
					className="flex w-full items-center justify-center gap-2"
				>
					<span aria-hidden="true">💻</span>
					<span>{t("serverCardActions.sshTerminalButton")}</span>
				</button>
			) : null}

			{canManageServers && directGateway ? (
				<ServerCardDirectGatewayForm serverId={serverId} directGateway={directGateway} />
			) : null}

			{canManageServers ? (
				<button
					type="button"
					onClick={() => setShowEdit((value) => !value)}
					data-action-button
					data-variant="secondary"
					className="w-full"
				>
					{showEdit
						? t("serverCardActions.edit.toggleHide")
						: t("serverCardActions.edit.toggleShow")}
				</button>
			) : null}

			{canManageServers && showEdit ? (
				<ServerCardEditForm
					serverId={serverId}
					serverName={serverName}
					host={host}
					port={port}
					username={username}
					connectionType={connectionType}
					description={description}
					tags={tags}
					costAutoSync={costAutoSync}
					costMonthlyAmount={costMonthlyAmount}
					costCurrency={costCurrency}
					costProvider={costProvider}
					costLastSyncedAt={costLastSyncedAt}
					editAction={editAction}
					editState={editState}
				/>
			) : null}

			{canManageServers ? (
				<form action={toggleAction} className="space-y-2">
					<input type="hidden" name="serverId" value={serverId} />
					<SubmitButton
						pendingLabel={t("serverCardActions.toggle.pending")}
						variant="ghost"
						className="w-full"
					>
						{enabled
							? t("serverCardActions.toggle.disable")
							: t("serverCardActions.toggle.enable")}
					</SubmitButton>
					{toggleState.error ? (
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
