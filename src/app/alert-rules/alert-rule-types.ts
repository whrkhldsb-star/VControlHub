export type AlertRule = {
	id: string;
	name: string;
	metric: string;
	operator: string;
	threshold: number;
	durationSeconds: number;
	serverIds: string[];
	notifyChannels: string[];
	webhookConfigured: boolean;
	playbookIds?: string[];
	cooldownMinutes: number;
	escalationMinutes?: number;
	onCallUserIds?: string[];
	enabled: boolean;
	silenceWindows?: string[];
	lastTriggeredAt: string | null;
	createdAt: string;
};

export type AlertIncident = {
	id: string;
	ruleId: string;
	ruleName: string | null;
	serverName: string;
	metric: string;
	status: string;
	level: number;
	title: string;
	message: string;
	value: number;
	threshold: number;
	operator: string;
	acknowledgedAt: string | null;
	acknowledgedBy: { id: string; username: string; displayName: string | null } | null;
	escalatedAt: string | null;
	createdAt: string;
};

export type TestDelivery = {
	channel: string;
	status: "sent" | "skipped" | "failed";
	message: string;
};

export type ServerOption = { id: string; name: string };
export type PlaybookOption = { id: string; name: string; enabled: boolean };

export function metricLabel(t: (key: string) => string, metric: string): string {
	const key = `alertRulesPage.metric.${metric}`;
	const value = t(key);
	return value === key ? metric : value;
}

export function operatorLabel(t: (key: string) => string, op: string): string {
	const key = `alertRulesPage.operator.${op}`;
	const value = t(key);
	return value === key ? op : value;
}

export function channelLabel(t: (key: string) => string, ch: string): string {
	const key = `alertRulesPage.channel.${ch}`;
	const value = t(key);
	return value === key ? ch : value;
}

export function deliveryStatusLabel(
	t: (key: string) => string,
	status: TestDelivery["status"],
): string {
	return t(`alertRulesPage.delivery.${status}`);
}
