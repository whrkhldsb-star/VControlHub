"use client";

import { ActionButton } from "@/components/action-button";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";

import {
	channelLabel,
	metricLabel,
	operatorLabel,
	type AlertRule,
} from "./alert-rule-types";

type Props = {
	rule: AlertRule;
	canManage: boolean;
	busyAction: string | null;
	toggleRule: (id: string) => Promise<void>;
	testRule: (rule: AlertRule) => Promise<void>;
	setRulePendingDelete: (rule: AlertRule | null) => void;
};

export function AlertRuleCard({
	rule,
	canManage,
	busyAction,
	toggleRule,
	testRule,
	setRulePendingDelete,
}: Props) {
	const { t, locale } = useI18n();

	return (
		<article
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
	);
}
