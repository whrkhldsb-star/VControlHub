"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { Notice, SegmentedControl } from "@/components/ui-primitives";
import { api } from "@/lib/http/api-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT, UI_LABEL } from "@/lib/ui/classes";
import { ServerTargetPicker, type ServerTarget } from "./server-target-picker";

export type CommandTargetOption = {
	id: string;
	name: string;
	host: string;
	available?: boolean;
	unavailableReason?: string;
};

type CommandResponse = {
	command: { id: string; status: string; requiresApproval?: boolean };
};

function newIdempotencyKey() {
	const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return `command-ui:${suffix}`;
}

export function CommandLaunchForm({ servers, allowDirectExecution, remoteTargets = false }: { servers: CommandTargetOption[]; allowDirectExecution: boolean; remoteTargets?: boolean }) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const router = useRouter();
	const [title, setTitle] = useState("");
	const [command, setCommand] = useState("");
	const [reason, setReason] = useState("");
	const [approvalRequired, setApprovalRequired] = useState(true);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const [remoteSelection, setRemoteSelection] = useState<ServerTarget[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmingDirect, setConfirmingDirect] = useState(false);
	const submissionRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
	const availableServers = servers.filter((server) => server.available !== false);
	const allSelected = availableServers.length > 0 && selectedIds.size === availableServers.length;
	const canSubmit = title.trim().length > 0 && command.trim().length > 0 && selectedIds.size > 0 && !submitting;
	const selectedNames = useMemo(
		() => (remoteTargets ? remoteSelection : servers).filter((server) => selectedIds.has(server.id)).map((server) => server.name),
		[servers, selectedIds, remoteTargets, remoteSelection],
	);

	function toggleServer(serverId: string) {
		setSelectedIds((current) => {
			const next = new Set(current);
			if (next.has(serverId)) next.delete(serverId);
			else next.add(serverId);
			return next;
		});
	}

	async function performSubmit() {
		if (!canSubmit) return;
		setConfirmingDirect(false);
		setSubmitting(true);
		setError(null);
		try {
			const payload = {
				title: title.trim(),
				command: command.trim(),
				reason: reason.trim() || undefined,
				serverIds: Array.from(selectedIds),
				submissionMode: "user",
				approvalRequired,
			} as const;
			const fingerprint = JSON.stringify(payload);
			if (submissionRef.current?.fingerprint !== fingerprint) {
				submissionRef.current = { fingerprint, idempotencyKey: newIdempotencyKey() };
			}
			await api.post<CommandResponse>("/api/commands", {
				...payload,
				idempotencyKey: submissionRef.current.idempotencyKey,
			});
			addToast("success", t(approvalRequired ? "serversPage.command.approvalSuccess" : "serversPage.command.success"));
			router.push("/requests");
			router.refresh();
		} catch (cause) {
			setError(getErrorMessage(cause, t("serversPage.command.failed")));
		} finally {
			setSubmitting(false);
		}
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSubmit) return;
		if (!approvalRequired) {
			setConfirmingDirect(true);
			return;
		}
		void performSubmit();
	}

	return (
		<>
		<form onSubmit={submit} className="space-y-5" aria-label={t("serversPage.command.title")}>
			<div>
				<h2 className="ui-title-section">{t("serversPage.command.title")}</h2>
				<p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{t("serversPage.command.desc")}</p>
			</div>
			<div className="space-y-2">
				<span className={UI_LABEL}>{t("serversPage.command.modeLabel")}</span>
				<SegmentedControl
					ariaLabel={t("serversPage.command.modeLabel")}
					value={approvalRequired ? "approval" : "direct"}
					onChange={(value) => setApprovalRequired(value === "approval")}
					options={[
						{ value: "approval", label: t("serversPage.command.modeApproval") },
						...(allowDirectExecution ? [{ value: "direct" as const, label: t("serversPage.command.modeDirect"), tone: "warning" as const }] : []),
					]}
				/>
			</div>
			<Notice tone={approvalRequired ? "info" : "warning"}>
				{t(approvalRequired ? "serversPage.command.approvalNotice" : "serversPage.command.executionNotice")}
			</Notice>
			{error ? <Notice tone="danger">{error}</Notice> : null}

			<div className="grid gap-4 lg:grid-cols-2">
				<label className="ui-label grid gap-1.5">
					<span>{t("serversPage.command.titleLabel")}</span>
					<input
						value={title}
						onChange={(event) => setTitle(event.currentTarget.value)}
						required
						maxLength={120}
						placeholder={t("serversPage.command.titlePlaceholder")}
						className={UI_INPUT}
					/>
				</label>
				<label className="ui-label grid gap-1.5">
					<span>{t("serversPage.command.reasonLabel")}</span>
					<input
						value={reason}
						onChange={(event) => setReason(event.currentTarget.value)}
						maxLength={500}
						placeholder={t("common.optional")}
						className={UI_INPUT}
					/>
				</label>
			</div>

			<label className="ui-label grid gap-1.5">
				<span>{t("serversPage.command.bodyLabel")}</span>
				<textarea
					value={command}
					onChange={(event) => setCommand(event.currentTarget.value)}
					required
					maxLength={10_000}
					rows={6}
					spellCheck={false}
					placeholder={t("serversPage.command.bodyPlaceholder")}
					className={`${UI_INPUT} resize-y font-mono`}
				/>
			</label>

			{remoteTargets ? <ServerTargetPicker kind="command" selected={remoteSelection.filter((row) => selectedIds.has(row.id))}
				onChange={(rows) => { setRemoteSelection(rows); setSelectedIds(new Set(rows.map((row) => row.id))); }} /> : <fieldset className="space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<legend className="ui-label">{t("serversPage.command.targetNodes")}</legend>
					<ActionButton size="sm"
						variant="secondary"
						onClick={() => setSelectedIds(allSelected ? new Set() : new Set(availableServers.map((server) => server.id)))}>
						{t(allSelected ? "serversPage.command.deselectAll" : "serversPage.command.selectAllEnabled")}
					</ActionButton>
				</div>
				<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
					{servers.map((server) => (
						<label key={server.id} data-tile="" data-selected={selectedIds.has(server.id) ? "" : undefined} className={`flex min-w-0 items-start gap-3 p-3 transition ${server.available === false ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
							<input
								type="checkbox"
								disabled={server.available === false}
								checked={selectedIds.has(server.id)}
								onChange={() => toggleServer(server.id)}
								className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
							/>
							<span className="min-w-0">
								<span className="block truncate text-sm font-medium text-[var(--text-primary)]">{server.name}</span>
								<span className="mt-0.5 block truncate font-mono text-xs text-[var(--text-muted)]">{server.host}</span>
								{server.unavailableReason ? <span className="mt-1 block text-xs text-[var(--danger)]">{server.unavailableReason}</span> : null}
							</span>
						</label>
					))}
				</div>
			</fieldset>}

			<div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-xs text-[var(--text-muted)]">
					{selectedIds.size > 0
						? t("serversPage.command.selectedSummary", { count: selectedIds.size, names: selectedNames.join(", ") })
						: t("serversPage.command.selectRequired")}
				</p>
				<ActionButton type="submit" disabled={!canSubmit} className="sm:min-w-36 disabled:opacity-50">
					{submitting ? t("serversPage.command.submitting") : t(approvalRequired ? "serversPage.command.submitApproval" : "serversPage.command.submitDirect")}
				</ActionButton>
			</div>
		</form>
		<ConfirmDialog
			open={confirmingDirect}
			title={t("serversPage.command.directConfirmTitle")}
			description={(
				<div className="space-y-3">
					<p>{t("serversPage.command.directConfirmDesc", { count: selectedIds.size })}</p>
					<div><span className="font-medium text-[var(--text-primary)]">{t("serversPage.command.targetNodes")}</span><p className="mt-1">{selectedNames.join(", ")}</p></div>
					<div><span className="font-medium text-[var(--text-primary)]">{t("serversPage.command.reasonLabel")}</span><p className="mt-1">{reason.trim() || t("serversPage.command.noReason")}</p></div>
					<code data-inset="" className="block max-h-48 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs text-[var(--text-primary)]">{command.trim()}</code>
				</div>
			)}
			cancelLabel={t("common.cancel")}
			confirmLabel={t("serversPage.command.directConfirmAction")}
			onCancel={() => setConfirmingDirect(false)}
			onConfirm={() => void performSubmit()}
			busy={submitting}
			closeOnBackdrop={false}
		/>
		</>
	);
}
