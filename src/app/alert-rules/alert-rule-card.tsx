"use client";

import { ActionButton } from "@/components/action-button";
import { Card } from "@/components/page-shell";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui-primitives";
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

const PERCENT_METRICS = new Set(["cpu_usage", "mem_usage", "disk_usage", "swap_usage"]);

export function AlertRuleCard({
	rule,
	canManage,
	busyAction,
	toggleRule,
	testRule,
	setRulePendingDelete,
}: Props) {
	const { t, locale } = useI18n();
	const silenceWindows = rule.silenceWindows ?? [];
	const playbookCount = rule.playbookIds?.length ?? 0;

	return (
		<Card as="article" className={rule.enabled ? undefined : "bg-[var(--surface-subtle)]"}>
			<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="ui-title-section">{rule.name}</h2>
						<StatusBadge tone={rule.enabled ? "success" : "neutral"}>
							{t(rule.enabled ? "alertRulesPage.state.enabled" : "alertRulesPage.state.paused")}
						</StatusBadge>
					</div>

					<p className="mt-1.5 text-[13px] leading-6 text-[var(--text-secondary)]">
						{t("alertRulesPage.condition.when")}{" "}
						<span className="font-medium text-[var(--text-primary)]">{metricLabel(t, rule.metric)}</span>
						{rule.metric !== "server_offline" ? (
							<>
								{" "}
								{operatorLabel(t, rule.operator)}{" "}
								<code className="rounded bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[12.5px] font-medium text-[var(--text-primary)]">
									{rule.threshold}
									{PERCENT_METRICS.has(rule.metric) ? "%" : ""}
								</code>
							</>
						) : null}
						{rule.durationSeconds > 0
							? t("alertRulesPage.condition.duration").replace("{seconds}", String(rule.durationSeconds))
							: null}
						<span className="text-[var(--text-muted)]">
							{rule.serverIds.length === 0
								? t("alertRulesPage.condition.allNodes")
								: t("alertRulesPage.condition.nodeCount").replace("{count}", String(rule.serverIds.length))}
						</span>
					</p>

					<div className="mt-2.5 flex flex-wrap gap-1.5">
						{rule.notifyChannels.map((channel) => (
							<Badge key={channel}>{channelLabel(t, channel)}</Badge>
						))}
						{rule.webhookConfigured ? <Badge tone="success">{t("alertRulesPage.badge.webhookConfigured")}</Badge> : null}
						{rule.cooldownMinutes > 0 ? (
							<Badge>{t("alertRulesPage.badge.cooldown").replace("{minutes}", String(rule.cooldownMinutes))}</Badge>
						) : null}
						<Badge>{t("alertRulesPage.badge.escalation").replace("{minutes}", String(rule.escalationMinutes ?? 30))}</Badge>
						{silenceWindows.length > 0 ? (
							<Badge tone="accent">
								{t("alertRulesPage.badge.silence").replace(
									"{windows}",
									silenceWindows.join(t("alertRulesPage.badge.silenceSeparator")),
								)}
							</Badge>
						) : null}
						{playbookCount > 0 ? (
							<Badge tone="accent">{t("alertRulesPage.badge.playbooks").replace("{count}", String(playbookCount))}</Badge>
						) : null}
					</div>

					{rule.lastTriggeredAt ? (
						<p className="mt-2 text-xs text-[var(--text-muted)]">
							{t("alertRulesPage.lastTriggered").replace(
								"{date}",
								new Date(rule.lastTriggeredAt).toLocaleString(toDateLocale(locale)),
							)}
						</p>
					) : null}
				</div>

				{canManage ? (
					<div className="flex shrink-0 flex-wrap items-center gap-2">
						<ActionButton
							size="sm"
							variant="secondary"
							onClick={() => testRule(rule)}
							loading={busyAction === `test:${rule.id}`}
						>
							{busyAction === `test:${rule.id}` ? t("alertRulesPage.action.sending") : t("alertRulesPage.action.testSend")}
						</ActionButton>
						<ActionButton
							size="sm"
							variant="secondary"
							onClick={() => toggleRule(rule.id)}
							loading={busyAction === `toggle:${rule.id}`}
						>
							{busyAction === `toggle:${rule.id}`
								? t("alertRulesPage.action.processing")
								: rule.enabled
									? t("alertRulesPage.action.pause")
									: t("alertRulesPage.action.enable")}
						</ActionButton>
						<ActionButton
							size="sm"
							variant="danger"
							onClick={() => setRulePendingDelete(rule)}
							loading={busyAction === `delete:${rule.id}`}
						>
							{busyAction === `delete:${rule.id}` ? t("alertRulesPage.action.deleting") : t("alertRulesPage.action.delete")}
						</ActionButton>
					</div>
				) : null}
			</div>
		</Card>
	);
}
