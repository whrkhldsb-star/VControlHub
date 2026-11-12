/**
 * An alert rule as the page and the API hand it out.
 *
 * One shape for both. The page built this shape itself, while every API answer carried the database row:
 * after the first refresh from the API the list held rows without `webhookConfigured` (the "webhook
 * configured" badge went away) and with `webhookUrl` — an address that usually carries a token, and that the
 * page deliberately never shows.
 */
export type AlertRuleDto = {
	id: string;
	name: string;
	metric: string;
	operator: string;
	threshold: number;
	durationSeconds: number;
	serverIds: string[];
	notifyChannels: string[];
	/** Whether an address is stored; the address itself stays on the server. */
	webhookConfigured: boolean;
	playbookIds: string[];
	cooldownMinutes: number;
	escalationMinutes: number;
	onCallUserIds: string[];
	silenceWindows: string[];
	enabled: boolean;
	lastTriggeredAt: string | null;
	createdAt: string;
};

export type AlertRuleRow = {
	id: string;
	name: string;
	metric: string;
	operator: string;
	threshold: number;
	durationSeconds: number;
	serverIds: string[];
	notifyChannels: string[];
	webhookUrl: string | null;
	playbookIds: string[] | null;
	cooldownMinutes: number;
	escalationMinutes: number | null;
	onCallUserIds: string[] | null;
	silenceWindows: string[] | null;
	enabled: boolean;
	lastTriggeredAt: Date | null;
	createdAt: Date;
};

export function toAlertRuleDto(rule: AlertRuleRow): AlertRuleDto {
	return {
		id: rule.id,
		name: rule.name,
		metric: rule.metric,
		operator: rule.operator,
		threshold: rule.threshold,
		durationSeconds: rule.durationSeconds,
		serverIds: rule.serverIds,
		notifyChannels: rule.notifyChannels,
		webhookConfigured: Boolean(rule.webhookUrl),
		playbookIds: rule.playbookIds ?? [],
		cooldownMinutes: rule.cooldownMinutes,
		escalationMinutes: rule.escalationMinutes ?? 30,
		onCallUserIds: rule.onCallUserIds ?? [],
		silenceWindows: rule.silenceWindows ?? [],
		enabled: rule.enabled,
		lastTriggeredAt: rule.lastTriggeredAt?.toISOString() ?? null,
		createdAt: rule.createdAt.toISOString(),
	};
}
