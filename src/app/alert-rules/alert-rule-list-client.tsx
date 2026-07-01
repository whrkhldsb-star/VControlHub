"use client";

import { useState, useCallback } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { EmptyState } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

type AlertRule = {
	id: string; name: string; metric: string; operator: string;
	threshold: number; durationSeconds: number; serverIds: string[];
	notifyChannels: string[]; webhookConfigured: boolean;
	playbookIds?: string[];
	cooldownMinutes: number; enabled: boolean;
	silenceWindows?: string[];
	lastTriggeredAt: string | null; createdAt: string;
};

type TestDelivery = {
	channel: string;
	status: "sent" | "skipped" | "failed";
	message: string;
};

type ServerOption = { id: string; name: string };
type PlaybookOption = { id: string; name: string; enabled: boolean };

type Props = {
	rules: AlertRule[];
	servers: ServerOption[];
	playbooks?: PlaybookOption[];
	canManage: boolean;
};

function metricLabel(t: (key: string) => string, metric: string): string {
	const key = `alertRulesPage.metric.${metric}`;
	const value = t(key);
	return value === key ? metric : value;
}

function operatorLabel(t: (key: string) => string, op: string): string {
	const key = `alertRulesPage.operator.${op}`;
	const value = t(key);
	return value === key ? op : value;
}

function channelLabel(t: (key: string) => string, ch: string): string {
	const key = `alertRulesPage.channel.${ch}`;
	const value = t(key);
	return value === key ? ch : value;
}

function deliveryStatusLabel(t: (key: string) => string, status: TestDelivery["status"]): string {
	return t(`alertRulesPage.delivery.${status}`);
}

export function AlertRuleListClient({ rules: initialRules, servers, playbooks = [], canManage }: Props) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const [rules, setRules] = useState(initialRules);
	const [showCreate, setShowCreate] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [testResult, setTestResult] = useState<{ ruleName: string; deliveries: TestDelivery[] } | null>(null);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [rulePendingDelete, setRulePendingDelete] = useState<AlertRule | null>(null);

	const getErrorMessage = useCallback(
		(error: unknown, fallbackKey: string) =>
			error instanceof Error ? error.message : t(fallbackKey),
		[t],
	);

	const refresh = useCallback(async () => {
		const data = await csrfFetch("/api/alert-rules");
		setRules(data?.rules ?? []);
	}, []);

	const toggleRule = useCallback(async (id: string) => {
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
	}, [refresh, getErrorMessage]);

	const deleteRule = useCallback(async (id: string) => {
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
	}, [refresh, getErrorMessage]);

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

	const testRule = useCallback(async (rule: AlertRule) => {
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
			const failed = deliveries.filter((delivery: TestDelivery) => delivery.status === "failed").length;
			addToast(
				failed > 0 ? "warning" : "success",
				failed > 0 ? t("alertRulesPage.toast.testPartial") : t("alertRulesPage.toast.testSucceeded"),
			);
		} catch (error) {
			setActionError(getErrorMessage(error, "alertRulesPage.error.test"));
		} finally {
			setBusyAction(null);
		}
	}, [addToast, t, getErrorMessage]);

	return (
		<div className="space-y-6">
			{rulePendingDelete && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-alert-rule-title">
					<div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl shadow-black/30">
						<h3 id="delete-alert-rule-title" className="text-base font-semibold text-[var(--text-primary)]">{t("alertRulesPage.delete.title")}</h3>
						<p className="mt-2 text-sm text-[var(--text-muted)]">
							{t("alertRulesPage.delete.confirm").replace("{name}", rulePendingDelete.name)}
						</p>
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setRulePendingDelete(null)}
								data-card className=" px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/[0.10]"
							>
								{t("alertRulesPage.delete.cancel")}
							</button>
							<button
								type="button"
								onClick={() => deleteRule(rulePendingDelete.id)}
								disabled={busyAction === `delete:${rulePendingDelete.id}`}
								data-tone="rose" className="rounded-xl border border-rose-400/30 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-60"
							>
								{busyAction === `delete:${rulePendingDelete.id}` ? t("alertRulesPage.delete.deleting") : t("alertRulesPage.delete.confirmBtn")}
							</button>
						</div>
					</div>
				</div>
			)}
			<div className="flex items-center gap-3 flex-wrap">
				{canManage && !showCreate && (
					<button onClick={() => setShowCreate(true)} data-tone="cyan" className="rounded-2xl border border-[var(--color-action-border)]/30 px-5 py-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--color-action-bg)]/20 transition">
						{t("alertRulesPage.create")}
					</button>
				)}
				{canManage && (
					<button
						type="button"
						onClick={triggerNow}
						disabled={busyAction === "trigger"}
						className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.04] px-5 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10] transition disabled:cursor-not-allowed disabled:opacity-60"
					>
						{busyAction === "trigger" ? t("alertRulesPage.triggering") : t("alertRulesPage.triggerNow")}
					</button>
				)}
			</div>

			{actionError && (
				<div role="alert" data-tone="rose" className="rounded-xl border border-rose-400/20 px-4 py-3 text-sm text-rose-100">
					{actionError}
				</div>
			)}

			{testResult && (
				<div role="status" data-tone="cyan" className="rounded-xl border border-[var(--color-action-border)]/20 px-4 py-3 text-sm text-[var(--text-primary)]">
					<p className="font-medium">{t("alertRulesPage.testResult").replace("{ruleName}", testResult.ruleName)}</p>
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
				<CreateRuleForm servers={servers} playbooks={playbooks} onClose={() => { setShowCreate(false); refresh(); }} />
			)}

			{rules.length === 0 ? (
				<EmptyState icon="🔔" variant="boxed">
					{t("alertRulesPage.empty")}
				</EmptyState>
			) : (
				<div className="space-y-3">
					{rules.map((rule) => (
						<article key={rule.id} className={`rounded-xl border bg-[var(--surface)]/[0.04] transition-colors duration-150 ${rule.enabled ? "border-[var(--border)] hover:bg-[var(--surface)]/[0.04]" : "border-[var(--border)] opacity-60"}`}>
							<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
								<div>
									<h2 className="text-lg font-semibold text-[var(--text-primary)]">{rule.name}</h2>
									<p className="mt-1 text-xs text-[var(--text-muted)]">
										{t("alertRulesPage.condition.when")} <span className="text-[var(--color-action)]/80">{metricLabel(t, rule.metric)}</span>{" "}
										{rule.metric !== "server_offline" && <>
											<span className="text-[var(--text-primary)]/70">{operatorLabel(t, rule.operator)}</span>{" "}
											<span className="text-amber-300 font-mono">{rule.threshold}%</span>
										</>}
										{rule.durationSeconds > 0 && <span className="text-[var(--text-muted)]">{t("alertRulesPage.condition.duration").replace("{seconds}", String(rule.durationSeconds))}</span>}
										{rule.serverIds.length === 0 ? t("alertRulesPage.condition.allNodes") : t("alertRulesPage.condition.nodeCount").replace("{count}", String(rule.serverIds.length))}
									</p>
									<div className="mt-2 flex flex-wrap gap-1.5">
										{rule.notifyChannels.map((ch) => (
											<span key={ch} className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
												{channelLabel(t, ch)}
											</span>
										))}
						{rule.webhookConfigured && (
							<span data-tone="emerald" className="rounded-lg border border-emerald-400/20 px-1.5 py-0.5 text-[10px] text-emerald-200">
								{t("alertRulesPage.badge.webhookConfigured")}
							</span>
						)}
						{rule.cooldownMinutes > 0 && (
							<span className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
								{t("alertRulesPage.badge.cooldown").replace("{minutes}", String(rule.cooldownMinutes))}
							</span>
						)}
						{(rule.silenceWindows?.length ?? 0) > 0 && (
							<span className="rounded-lg border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 text-[10px] text-violet-200">
								{t("alertRulesPage.badge.silence").replace("{windows}", rule.silenceWindows?.join("、") ?? "")}
							</span>
						)}
						{(rule.playbookIds?.length ?? 0) > 0 && (
							<span className="rounded-lg border border-[var(--color-action-border)]/20 bg-[var(--color-action-bg)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-action)]">
								{t("alertRulesPage.badge.playbooks").replace("{count}", String(rule.playbookIds?.length ?? 0))}
							</span>
						)}
									</div>
									{rule.lastTriggeredAt && (
										<p className="mt-1 text-[11px] text-[var(--text-muted)]">{t("alertRulesPage.lastTriggered").replace("{date}", new Date(rule.lastTriggeredAt).toLocaleString("zh-CN"))}</p>
									)}
								</div>
								{canManage && (
									<div className="flex flex-col gap-2 shrink-0">
						<button
							onClick={() => toggleRule(rule.id)}
							disabled={busyAction === `toggle:${rule.id}`}
							className={`rounded-2xl border px-4 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
								rule.enabled
									? "border-amber-400/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20"
									: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20"
							}`}
						>
							{busyAction === `toggle:${rule.id}` ? t("alertRulesPage.action.processing") : rule.enabled ? t("alertRulesPage.action.pause") : t("alertRulesPage.action.enable")}
						</button>
						<button
							onClick={() => testRule(rule)}
							disabled={busyAction === `test:${rule.id}`}
							data-tone="cyan" className="rounded-2xl border border-[var(--color-action-border)]/30 px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--color-action-bg)]/20 transition disabled:cursor-not-allowed disabled:opacity-60"
						>
							{busyAction === `test:${rule.id}` ? t("alertRulesPage.action.sending") : t("alertRulesPage.action.testSend")}
						</button>
						<button
							onClick={() => setRulePendingDelete(rule)}
							disabled={busyAction === `delete:${rule.id}`}
							data-tone="rose" className="rounded-2xl border border-rose-400/30 px-4 py-2 text-xs font-medium text-rose-100 hover:bg-rose-400/20 transition disabled:cursor-not-allowed disabled:opacity-60"
						>
							{busyAction === `delete:${rule.id}` ? t("alertRulesPage.action.deleting") : t("alertRulesPage.action.delete")}
						</button>
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

/* ── Create form ──────────────────────────────────────────── */

function CreateRuleForm({ servers, playbooks, onClose }: { servers: ServerOption[]; playbooks: PlaybookOption[]; onClose: () => void }) {
	const { t } = useI18n();
	const [name, setName] = useState("");
	const [metric, setMetric] = useState("cpu_usage");
	const [operator, setOperator] = useState("gte");
	const [threshold, setThreshold] = useState(85);
	const [durationSeconds, setDurationSeconds] = useState(0);
	const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
	const [selectedPlaybookIds, setSelectedPlaybookIds] = useState<string[]>([]);
	const [cooldown, setCooldown] = useState(30);
	const [silenceWindowsText, setSilenceWindowsText] = useState("");
	const [channels, setChannels] = useState<string[]>(["in_app"]);
	const [webhookUrl, setWebhookUrl] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const toggleChannel = (ch: string) => {
		setChannels((prev) => prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]);
	};

	const toggleServer = (serverId: string) => {
		setSelectedServerIds((prev) => prev.includes(serverId) ? prev.filter((id) => id !== serverId) : [...prev, serverId]);
	};

	const togglePlaybook = (playbookId: string) => {
		setSelectedPlaybookIds((prev) => prev.includes(playbookId) ? prev.filter((id) => id !== playbookId) : [...prev, playbookId]);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		const silenceWindows = silenceWindowsText.split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean);
		try {
			await csrfFetch("/api/alert-rules", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					metric,
					operator,
					threshold,
					durationSeconds,
					serverIds: selectedServerIds,
					playbookIds: selectedPlaybookIds,
					notifyChannels: channels,
					cooldownMinutes: cooldown,
					silenceWindows,
					webhookUrl: channels.includes("webhook") && webhookUrl.trim() ? webhookUrl.trim() : undefined,
				}),
			});
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("alertRulesPage.createForm.error"));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} data-card className=" space-y-4">
			<h3 className="text-lg font-semibold text-[var(--text-primary)]">{t("alertRulesPage.createForm.title")}</h3>
			{error && <div className="rounded-lg bg-rose-500/[0.10] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200">{error}</div>}

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="alertRuleName">{t("alertRulesPage.createForm.name")}</label>
				<input id="alertRuleName" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t("alertRulesPage.createForm.namePlaceholder")} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30" />
			</div>

			<div className="grid gap-3 sm:grid-cols-3">
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="alertRuleMetric">{t("alertRulesPage.createForm.metric")}</label>
					<select id="alertRuleMetric" value={metric} onChange={(e) => setMetric(e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none">
							<option value="cpu_usage">{t("alertRulesPage.createForm.metric.cpu_usage")}</option>
							<option value="mem_usage">{t("alertRulesPage.createForm.metric.mem_usage")}</option>
							<option value="disk_usage">{t("alertRulesPage.createForm.metric.disk_usage")}</option>
							<option value="server_offline">{t("alertRulesPage.createForm.metric.server_offline")}</option>
							<option value="network_in">{t("alertRulesPage.createForm.metric.network_in")}</option>
							<option value="network_out">{t("alertRulesPage.createForm.metric.network_out")}</option>
							<option value="load_avg">{t("alertRulesPage.createForm.metric.load_avg")}</option>
							<option value="swap_usage">{t("alertRulesPage.createForm.metric.swap_usage")}</option>
					</select>
				</div>
				{metric !== "server_offline" && <div className="space-y-1.5">
					<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="alertRuleOperator">{t("alertRulesPage.createForm.operator")}</label>
					<select id="alertRuleOperator" value={operator} onChange={(e) => setOperator(e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none">
							<option value="gt">{t("alertRulesPage.createForm.operator.gt")}</option>
							<option value="gte">{t("alertRulesPage.createForm.operator.gte")}</option>
							<option value="lt">{t("alertRulesPage.createForm.operator.lt")}</option>
							<option value="lte">{t("alertRulesPage.createForm.operator.lte")}</option>
					</select>
				</div>}
				{metric !== "server_offline" && <div className="space-y-1.5">
					<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="alertThreshold">{t("alertRulesPage.createForm.threshold")}</label>
					<input id="alertThreshold" type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} min={0} max={100} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none focus:border-[var(--color-action-border)]/30" />
				</div>}
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="alertDurationSeconds">{t("alertRulesPage.createForm.duration")}</label>
					<input id="alertDurationSeconds" type="number" value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} min={0} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none focus:border-[var(--color-action-border)]/30" />
					<p className="text-xs text-[var(--text-muted)]">{t("alertRulesPage.createForm.durationHint")}</p>
				</div>
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">{t("alertRulesPage.createForm.targetNodes")}</label>
					<div className="flex flex-wrap gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] p-2">
						{servers.length === 0 ? (
							<span className="text-xs text-[var(--text-muted)]">{t("alertRulesPage.createForm.noNodes")}</span>
						) : (
							<>
								<button type="button" onClick={() => setSelectedServerIds([])} className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${selectedServerIds.length === 0 ? "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-secondary)]" : "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-muted)]"}`}>{t("alertRulesPage.createForm.allNodes")}</button>
								{servers.map((server) => (
									<button key={server.id} type="button" onClick={() => toggleServer(server.id)} className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${selectedServerIds.includes(server.id) ? "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-secondary)]" : "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-muted)] hover:bg-[var(--surface)]/[0.10]"}`}>
											{server.name}
									</button>
								))}
							</>
						)}
					</div>
				</div>
			</div>

			<div className="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]/[0.04] p-3">
				<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">{t("alertRulesPage.createForm.playbooks")}</label>
				<p className="text-xs text-[var(--text-muted)]">{t("alertRulesPage.createForm.playbooksHint")}</p>
				<div className="mt-2 flex flex-wrap gap-1.5">
					{playbooks.length === 0 ? (
						<span className="text-xs text-[var(--text-muted)]">{t("alertRulesPage.createForm.noPlaybooks")}</span>
					) : (
						playbooks.map((playbook) => (
							<button key={playbook.id} type="button" onClick={() => togglePlaybook(playbook.id)} disabled={!playbook.enabled} className={`rounded-lg border px-2.5 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50 ${selectedPlaybookIds.includes(playbook.id) ? "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-secondary)]" : "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-muted)] hover:bg-[var(--surface)]/[0.10]"}`}>
								{playbook.name}{!playbook.enabled ? ` · ${t("alertRulesPage.createForm.playbookDisabled")}` : ""}
							</button>
						))
					)}
				</div>
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">{t("alertRulesPage.createForm.channels")}</label>
				<div className="flex flex-wrap gap-2">
					{[
						{ key: "in_app", i18nKey: "alertRulesPage.createForm.channel.in_app" },
						{ key: "email", i18nKey: "alertRulesPage.createForm.channel.email" },
						{ key: "telegram", i18nKey: "alertRulesPage.createForm.channel.telegram" },
						{ key: "webhook", i18nKey: "alertRulesPage.createForm.channel.webhook" },
					].map(({ key, i18nKey }) => (
						<button key={key} type="button" onClick={() => toggleChannel(key)}
							className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${channels.includes(key) ? "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-secondary)]" : "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-muted)] hover:bg-[var(--surface)]/[0.10]"}`}
						>
								{t(i18nKey)}
						</button>
					))}
				</div>
			</div>

			{channels.includes("webhook") && (
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="alertRuleWebhookUrl">{t("alertRulesPage.createForm.webhookUrl")}</label>
					<input id="alertRuleWebhookUrl" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://hooks.example.com/..." className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30" />
				</div>
			)}

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="alertRuleCooldown">{t("alertRulesPage.createForm.cooldown")}</label>
				<input id="alertRuleCooldown" type="number" value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} min={1} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none focus:border-[var(--color-action-border)]/30 w-32" />
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="alertSilenceWindows">{t("alertRulesPage.createForm.silenceWindows")}</label>
				<textarea id="alertSilenceWindows" value={silenceWindowsText} onChange={(e) => setSilenceWindowsText(e.target.value)} rows={2} placeholder={t("alertRulesPage.createForm.silenceWindowsPlaceholder")} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30" />
				<p className="text-xs text-[var(--text-muted)]">{t("alertRulesPage.createForm.silenceWindowsHint")}</p>
			</div>

			<div className="flex gap-3 pt-2">
				<button type="submit" disabled={submitting} className="rounded-2xl bg-[var(--color-action)] px-5 py-2 text-sm font-medium text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)] disabled:opacity-60">
					{submitting ? t("alertRulesPage.createForm.submitting") : t("alertRulesPage.createForm.submit")}
				</button>
				<button type="button" onClick={onClose} className="rounded-2xl border border-[var(--border)] px-5 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface)]/10 transition">
					{t("alertRulesPage.createForm.cancel")}
				</button>
			</div>
		</form>
	);
}
