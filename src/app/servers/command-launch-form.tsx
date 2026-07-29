"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { ActionButton } from "@/components/action-button";
import { useToast } from "@/components/toast-provider";
import { Notice } from "@/components/ui-primitives";
import { api } from "@/lib/http/api-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

export type CommandTargetOption = {
	id: string;
	name: string;
	host: string;
};

type CommandResponse = {
	command: { id: string; status: string; requiresApproval?: boolean };
};

function newIdempotencyKey() {
	const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return `command-ui:${suffix}`;
}

export function CommandLaunchForm({ servers, allowDirectExecution }: { servers: CommandTargetOption[]; allowDirectExecution: boolean }) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const router = useRouter();
	const [title, setTitle] = useState("");
	const [command, setCommand] = useState("");
	const [reason, setReason] = useState("");
	const [approvalRequired, setApprovalRequired] = useState(true);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submissionRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
	const allSelected = servers.length > 0 && selectedIds.size === servers.length;
	const canSubmit = title.trim().length > 0 && command.trim().length > 0 && selectedIds.size > 0 && !submitting;
	const selectedNames = useMemo(
		() => servers.filter((server) => selectedIds.has(server.id)).map((server) => server.name),
		[servers, selectedIds],
	);

	function toggleServer(serverId: string) {
		setSelectedIds((current) => {
			const next = new Set(current);
			if (next.has(serverId)) next.delete(serverId);
			else next.add(serverId);
			return next;
		});
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSubmit) return;
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

	return (
		<form onSubmit={submit} className="space-y-5" aria-label={t("serversPage.command.title")}>
			<div>
				<h2 className="text-lg font-semibold text-[var(--text-primary)]">{t("serversPage.command.title")}</h2>
				<p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{t("serversPage.command.desc")}</p>
			</div>
			<fieldset className="space-y-2">
				<legend className="text-sm font-medium text-[var(--text-secondary)]">{t("serversPage.command.modeLabel")}</legend>
				<div className="inline-flex max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-1">
					<button
						type="button"
						onClick={() => setApprovalRequired(true)}
						aria-pressed={approvalRequired}
						className={`rounded-md px-3 py-2 text-sm font-medium transition ${approvalRequired ? "bg-[var(--accent-bg)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
					>
						{t("serversPage.command.modeApproval")}
					</button>
					{allowDirectExecution ? (
						<button
							type="button"
							onClick={() => setApprovalRequired(false)}
							aria-pressed={!approvalRequired}
							className={`rounded-md px-3 py-2 text-sm font-medium transition ${!approvalRequired ? "bg-[var(--warning-bg)] text-[var(--warning)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
						>
							{t("serversPage.command.modeDirect")}
						</button>
					) : null}
				</div>
			</fieldset>
			<Notice tone={approvalRequired ? "info" : "warning"}>
				{t(approvalRequired ? "serversPage.command.approvalNotice" : "serversPage.command.executionNotice")}
			</Notice>
			{error ? <Notice tone="danger">{error}</Notice> : null}

			<div className="grid gap-4 lg:grid-cols-2">
				<label className="grid gap-1.5 text-sm text-[var(--text-secondary)]">
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
				<label className="grid gap-1.5 text-sm text-[var(--text-secondary)]">
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

			<label className="grid gap-1.5 text-sm text-[var(--text-secondary)]">
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

			<fieldset className="space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<legend className="text-sm font-medium text-[var(--text-secondary)]">{t("serversPage.command.targetNodes")}</legend>
					<ActionButton
						variant="secondary"
						onClick={() => setSelectedIds(allSelected ? new Set() : new Set(servers.map((server) => server.id)))}
						className="!px-3 !py-1.5 !text-xs"
					>
						{t(allSelected ? "serversPage.command.deselectAll" : "serversPage.command.selectAllEnabled")}
					</ActionButton>
				</div>
				<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
					{servers.map((server) => (
						<label key={server.id} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 hover:bg-[var(--surface-elevated)]">
							<input
								type="checkbox"
								checked={selectedIds.has(server.id)}
								onChange={() => toggleServer(server.id)}
								className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
							/>
							<span className="min-w-0">
								<span className="block truncate text-sm font-medium text-[var(--text-primary)]">{server.name}</span>
								<span className="mt-0.5 block truncate font-mono text-xs text-[var(--text-muted)]">{server.host}</span>
							</span>
						</label>
					))}
				</div>
			</fieldset>

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
	);
}
