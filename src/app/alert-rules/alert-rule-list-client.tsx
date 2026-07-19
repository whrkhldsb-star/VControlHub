"use client";

import { useCallback, useEffect, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { EmptyState, SurfacePanel, Toolbar } from "@/components/page-shell";
import { useToast } from "@/components/toast-provider";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";

import {
	channelLabel,
	deliveryStatusLabel,
	metricLabel,
	operatorLabel,
	type AlertIncident,
	type AlertRule,
	type PlaybookOption,
	type ServerOption,
	type TestDelivery,
} from "./alert-rule-types";
import { CreateRuleForm } from "./create-rule-form";

type Props = {
	rules: AlertRule[];
	servers: ServerOption[];
	playbooks?: PlaybookOption[];
	canManage: boolean;
};

export function AlertRuleListClient({
	rules: initialRules,
	servers,
	playbooks = [],
	canManage,
}: Props) {
	const { t, locale } = useI18n();
	const { addToast } = useToast();
	const [rules, setRules] = useState(initialRules);
	const [incidents, setIncidents] = useState<AlertIncident[]>([]);
	const [incidentsLoading, setIncidentsLoading] = useState(false);
	const [showCreate, setShowCreate] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [testResult, setTestResult] = useState<{
		ruleName: string;
		deliveries: TestDelivery[];
	} | null>(null);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [rulePendingDelete, setRulePendingDelete] = useState<AlertRule | null>(null);

	const closeDeleteDialog = useCallback(() => setRulePendingDelete(null), []);
	const dialogRef = useDialogFocus<HTMLDivElement>({
		open: rulePendingDelete !== null,
		onClose: closeDeleteDialog,
	});

	const getErrorMessage = useCallback(
		(error: unknown, fallbackKey: string) =>
			error instanceof Error ? error.message : t(fallbackKey),
		[t],
	);

	const refresh = useCallback(async () => {
		const data = await csrfFetch("/api/alert-rules");
		setRules(data?.rules ?? []);
	}, []);

	const loadIncidents = useCallback(async () => {
		if (!canManage) return;
		setIncidentsLoading(true);
		try {
			const data = await csrfFetch("/api/alert-incidents");
			setIncidents((data?.incidents ?? []) as AlertIncident[]);
		} catch {
			// best-effort panel
		} finally {
			setIncidentsLoading(false);
		}
	}, [canManage]);

	/* eslint-disable react-hooks/set-state-in-effect -- bootstrap open incidents panel */
	useEffect(() => {
		void loadIncidents();
	}, [loadIncidents]);
	/* eslint-enable react-hooks/set-state-in-effect */

	const ackIncident = useCallback(
		async (incidentId: string) => {
			setBusyAction(`ack:${incidentId}`);
			try {
				await csrfFetch("/api/alert-incidents", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ incidentId }),
				});
				addToast("success", t("alertRulesPage.incidents.acked"));
				await loadIncidents();
			} catch (error) {
				setActionError(error instanceof Error ? error.message : t("alertRulesPage.error.toggle"));
			} finally {
				setBusyAction(null);
			}
		},
		[addToast, loadIncidents, t],
	);

	const toggleRule = useCallback(
		async (id: string) => {
			setActionError(null);
			setTestResult(null);
			setBusyAction(`toggle:${id}`);
			try {
				await csrfFetch("/api/alert-rules", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ toggleId: id }),
				});
				await refresh();
			} catch (error) {
				setActionError(getErrorMessage(error, "alertRulesPage.error.toggle"));
			} finally {
				setBusyAction(null);
			}
		},
		[refresh, getErrorMessage],
	);

	const deleteRule = useCallback(
		async (id: string) => {
			setActionError(null);
			setTestResult(null);
			setBusyAction(`delete:${id}`);
			try {
				await csrfFetch(`/api/alert-rules?id=${id}`, { method: "DELETE" });
				setRulePendingDelete(null);
				await refresh();
			} catch (error) {
				setActionError(getErrorMessage(error, "alertRulesPage.error.delete"));
			} finally {
				setBusyAction(null);
			}
		},
		[refresh, getErrorMessage],
	);

	const triggerNow = useCallback(async () => {
		setActionError(null);
		setTestResult(null);
		setBusyAction("trigger");
		try {
			await csrfFetch("/api/alert-rules", { method: "PUT" });
			addToast("success", t("alertRulesPage.toast.triggered"));
			await refresh();
		} catch (error) {
			setActionError(getErrorMessage(error, "alertRulesPage.error.trigger"));
		} finally {
			setBusyAction(null);
		}
	}, [addToast, refresh, t, getErrorMessage]);

	const ensureDefaults = useCallback(async () => {
		setActionError(null);
		setTestResult(null);
		setBusyAction("defaults");
		try {
			const data = await csrfFetch("/api/alert-rules", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ensureDefaults: true }),
			});
			if (Array.isArray(data?.rules)) {
				setRules(data.rules);
			} else {
				await refresh();
			}
			const created = Number(data?.created ?? 0);
			addToast(
				"success",
				created > 0
					? t("alertRulesPage.toast.defaultsCreated").replace("{count}", String(created))
					: t("alertRulesPage.toast.defaultsExists"),
			);
		} catch (error) {
			setActionError(getErrorMessage(error, "alertRulesPage.error.defaults"));
		} finally {
			setBusyAction(null);
		}
	}, [addToast, refresh, t, getErrorMessage]);

	const testRule = useCallback(
		async (rule: AlertRule) => {
			setActionError(null);
			setTestResult(null);
			setBusyAction(`test:${rule.id}`);
			try {
				const data = await csrfFetch("/api/alert-rules", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ testId: rule.id }),
				});
				const deliveries = Array.isArray(data?.deliveries) ? data?.deliveries : [];
				setTestResult({ ruleName: rule.name, deliveries });
				const failed = deliveries.filter(
					(delivery: TestDelivery) => delivery.status === "failed",
				).length;
				addToast(
					failed > 0 ? "warning" : "success",
					failed > 0
						? t("alertRulesPage.toast.testPartial")
						: t("alertRulesPage.toast.testSucceeded"),
				);
			} catch (error) {
				setActionError(getErrorMessage(error, "alertRulesPage.error.test"));
			} finally {
				setBusyAction(null);
			}
		},
		[addToast, t, getErrorMessage],
	);

	return (
		<div className="space-y-6">
			{rulePendingDelete && (
				<div
					ref={dialogRef}
					className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
					role="dialog"
					aria-modal="true"
					aria-labelledby="delete-alert-rule-title"
				>
					<div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl shadow-black/30">
						<h3
							id="delete-alert-rule-title"
							className="text-base font-semibold text-[var(--text-primary)]"
						>
							{t("alertRulesPage.delete.title")}
						</h3>
						<p className="mt-2 text-sm text-[var(--text-muted)]">
							{t("alertRulesPage.delete.confirm").replace(
								"{name}",
								rulePendingDelete.name,
							)}
						</p>
						<div className="mt-5 flex justify-end gap-2">
							<ActionButton
								type="button"
								variant="secondary"
								onClick={() => setRulePendingDelete(null)}
							>
								{t("alertRulesPage.delete.cancel")}
							</ActionButton>
							<ActionButton
								type="button"
								variant="danger"
								onClick={() => deleteRule(rulePendingDelete.id)}
								disabled={busyAction === `delete:${rulePendingDelete.id}`}
							>
								{busyAction === `delete:${rulePendingDelete.id}`
									? t("alertRulesPage.delete.deleting")
									: t("alertRulesPage.delete.confirmBtn")}
							</ActionButton>
						</div>
					</div>
				</div>
			)}

			
			<section className="mb-6 space-y-3" aria-label={t("alertRulesPage.incidents.title")}>
				<div className="flex items-center justify-between gap-2">
					<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("alertRulesPage.incidents.title")}</h2>
					<button
						type="button"
						onClick={() => void loadIncidents()}
						data-action-button data-variant="secondary" className="!min-h-11 !px-3 !text-xs"
					>
						{incidentsLoading ? "…" : t("alertRulesPage.incidents.refresh")}
					</button>
				</div>
				{incidents.filter((i) => i.status !== "RESOLVED").length === 0 ? (
					<p className="text-xs text-[var(--text-muted)]">{t("alertRulesPage.incidents.empty")} ({incidents.filter((i) => i.status === "RESOLVED").length} {t("alertRulesPage.incidents.resolved")})</p>
				) : (
					<div className="space-y-2">
						{incidents
							.filter((i) => i.status !== "RESOLVED")
							.slice(0, 20)
							.map((incident) => (
								<div
									key={incident.id}
									className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<span className="rounded-full bg-[var(--danger-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--danger)]">
												{t("alertRulesPage.incidents.level").replace("{level}", String(incident.level))}
											</span>
											<span className="text-sm font-medium text-[var(--text-primary)]">{incident.title}</span>
											<span className="text-[10px] text-[var(--text-muted)]">
												{incident.status === "ACKNOWLEDGED"
													? t("alertRulesPage.incidents.acked")
													: t("alertRulesPage.incidents.open")}
											</span>
										</div>
										<p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{incident.message}</p>
									</div>
									{incident.status === "OPEN" && (
										<button
											type="button"
											disabled={busyAction === `ack:${incident.id}`}
											onClick={() => void ackIncident(incident.id)}
											data-action-button data-variant="primary" className="!min-h-11 !px-3 !text-xs !font-semibold disabled:opacity-50"
										>
											{t("alertRulesPage.incidents.ack")}
										</button>
									)}
								</div>
							))}
					</div>
				)}
			</section>
<Toolbar className="flex-wrap">
				{canManage && (
					<>
						{rules.length === 0 ? (
							<ActionButton
								type="button"
								variant="primary"
								onClick={() => void ensureDefaults()}
								disabled={busyAction === "defaults"}
							>
								{busyAction === "defaults"
									? t("alertRulesPage.action.processing")
									: t("alertRulesPage.ensureDefaults")}
							</ActionButton>
						) : null}
						{!showCreate && (
							<ActionButton type="button" variant="outline" onClick={() => setShowCreate(true)}>
								{t("alertRulesPage.create")}
							</ActionButton>
						)}
						<ActionButton
							type="button"
							variant="secondary"
							onClick={triggerNow}
							disabled={busyAction === "trigger"}
						>
							{busyAction === "trigger"
								? t("alertRulesPage.triggering")
								: t("alertRulesPage.triggerNow")}
						</ActionButton>
					</>
				)}
			</Toolbar>

			{actionError && (
				<div
					role="alert"
					data-tone="rose"
					className="rounded-xl border border-[var(--danger-border)] px-4 py-3 text-sm text-[var(--danger)]"
				>
					{actionError}
				</div>
			)}

			{testResult && (
				<div
					role="status"
					data-tone="cyan"
					className="rounded-xl border border-[var(--color-action-border)]/20 px-4 py-3 text-sm text-[var(--text-primary)]"
				>
					<p className="font-medium">
						{t("alertRulesPage.testResult").replace("{ruleName}", testResult.ruleName)}
					</p>
					<ul className="mt-2 space-y-1">
						{testResult.deliveries.map((delivery, index) => (
							<li key={`${delivery.channel}-${index}`} className="flex flex-wrap gap-2 text-xs">
								<span className="font-mono uppercase">{delivery.channel}</span>
								<span>{deliveryStatusLabel(t, delivery.status)}</span>
								<span className="text-[var(--text-primary)]/70">{delivery.message}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{showCreate && (
				<div className="mb-1">
					<SurfacePanel title={t("alertRulesPage.create")}>
						<CreateRuleForm
							servers={servers}
							playbooks={playbooks}
							onClose={() => {
								setShowCreate(false);
								void refresh();
							}}
						/>
					</SurfacePanel>
				</div>
			)}

			{rules.length === 0 ? (
				<EmptyState icon="🔔" variant="boxed">
					<div className="space-y-3">
						<p>{t("alertRulesPage.empty")}</p>
						<p className="text-xs text-[var(--text-muted)]">{t("alertRulesPage.emptyHint")}</p>
						{canManage ? (
							<div className="flex flex-wrap justify-center gap-2">
								<ActionButton
									type="button"
									variant="primary"
									onClick={() => void ensureDefaults()}
									disabled={busyAction === "defaults"}
								>
									{busyAction === "defaults"
										? t("alertRulesPage.action.processing")
										: t("alertRulesPage.ensureDefaults")}
								</ActionButton>
							</div>
						) : null}
					</div>
				</EmptyState>
			) : (
				<div className="space-y-3">
					{rules.map((rule) => (
						<article
							key={rule.id}
							className={`rounded-xl border bg-[var(--surface-elevated)] transition-colors duration-150 ${
								rule.enabled
									? "border-[var(--border)] hover:bg-[var(--surface-elevated)]"
									: "border-[var(--border)] opacity-60"
							}`}
						>
							<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
								<div>
									<h2 className="text-lg font-semibold text-[var(--text-primary)]">
										{rule.name}
									</h2>
									<p className="mt-1 text-xs text-[var(--text-muted)]">
										{t("alertRulesPage.condition.when")}{" "}
										<span className="text-[var(--color-action)]/80">
											{metricLabel(t, rule.metric)}
										</span>{" "}
										{rule.metric !== "server_offline" && (
											<>
												<span className="text-[var(--text-primary)]/70">
													{operatorLabel(t, rule.operator)}
												</span>{" "}
												<span className="font-mono text-[var(--warning)]">
													{rule.threshold}
													{["cpu_usage", "mem_usage", "disk_usage", "swap_usage"].includes(
														rule.metric,
													)
														? "%"
														: ""}
												</span>
											</>
										)}
										{rule.durationSeconds > 0 && (
											<span className="text-[var(--text-muted)]">
												{t("alertRulesPage.condition.duration").replace(
													"{seconds}",
													String(rule.durationSeconds),
												)}
											</span>
										)}
										{rule.serverIds.length === 0
											? t("alertRulesPage.condition.allNodes")
											: t("alertRulesPage.condition.nodeCount").replace(
													"{count}",
													String(rule.serverIds.length),
												)}
									</p>
									<div className="mt-2 flex flex-wrap gap-1.5">
										{rule.notifyChannels.map((ch) => (
											<span
												key={ch}
												className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
											>
												{channelLabel(t, ch)}
											</span>
										))}
										{rule.webhookConfigured && (
											<span
												data-tone="emerald"
												className="rounded-lg border border-[var(--success-border)] px-1.5 py-0.5 text-[10px] text-[var(--success)]"
											>
												{t("alertRulesPage.badge.webhookConfigured")}
											</span>
										)}
										{rule.cooldownMinutes > 0 && (
											<span className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
												{t("alertRulesPage.badge.cooldown").replace(
													"{minutes}",
													String(rule.cooldownMinutes),
												)}
											</span>
										)}
										<span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
											{t("alertRulesPage.badge.escalation").replace(
												"{minutes}",
												String(rule.escalationMinutes ?? 30),
											)}
										</span>
										{(rule.silenceWindows?.length ?? 0) > 0 && (
											<span className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
												{t("alertRulesPage.badge.silence").replace(
													"{windows}",
													rule.silenceWindows?.join(
														t("alertRulesPage.badge.silenceSeparator"),
													) ?? "",
												)}
											</span>
										)}
										{(rule.playbookIds?.length ?? 0) > 0 && (
											<span className="rounded-lg border border-[var(--color-action-border)]/20 bg-[var(--color-action-bg)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-action)]">
												{t("alertRulesPage.badge.playbooks").replace(
													"{count}",
													String(rule.playbookIds?.length ?? 0),
												)}
											</span>
										)}
									</div>
									{rule.lastTriggeredAt && (
										<p className="mt-1 text-[11px] text-[var(--text-muted)]">
											{t("alertRulesPage.lastTriggered").replace(
												"{date}",
												new Date(rule.lastTriggeredAt).toLocaleString(
													toDateLocale(locale),
												),
											)}
										</p>
									)}
								</div>
								{canManage && (
									<div className="flex shrink-0 flex-col gap-2">
										<button
											type="button"
											onClick={() => toggleRule(rule.id)}
											disabled={busyAction === `toggle:${rule.id}`}
											className={`rounded-2xl border px-4 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
												rule.enabled
													? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] hover:bg-[var(--warning-bg)]/60"
													: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)] hover:bg-[var(--success-bg)]/60"
											}`}
										>
											{busyAction === `toggle:${rule.id}`
												? t("alertRulesPage.action.processing")
												: rule.enabled
													? t("alertRulesPage.action.pause")
													: t("alertRulesPage.action.enable")}
										</button>
										<ActionButton
											type="button"
											variant="outline"
											onClick={() => testRule(rule)}
											disabled={busyAction === `test:${rule.id}`}
											className="text-xs"
										>
											{busyAction === `test:${rule.id}`
												? t("alertRulesPage.action.sending")
												: t("alertRulesPage.action.testSend")}
										</ActionButton>
										<ActionButton
											type="button"
											variant="danger"
											onClick={() => setRulePendingDelete(rule)}
											disabled={busyAction === `delete:${rule.id}`}
											className="text-xs"
										>
											{busyAction === `delete:${rule.id}`
												? t("alertRulesPage.action.deleting")
												: t("alertRulesPage.action.delete")}
										</ActionButton>
									</div>
								)}
							</div>
						</article>
					))}
				</div>
			)}
		</div>
	);
}
