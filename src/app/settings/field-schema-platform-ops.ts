import { runtimeNumber, type FieldDef, type SectionDef } from "./field-schema-core";

/**
 * Sections added in the 2026-10 settings expansion: security policy, jobs,
 * alerts, storage, monitoring, data retention and AI. Every numeric field is
 * a runtime setting (database over environment variable over default) whose
 * range lives in src/lib/runtime-settings/service.ts; the schema repeats it
 * for client-side validation.
 */
function knob(key: string, defaultValue: string, min: number, max: number, riskLevel: FieldDef["riskLevel"] = "medium"): FieldDef {
	return Object.assign(runtimeNumber(key, `settingsClient.field.${key}.label`, defaultValue, min, max), {
		helperTextKey: `settingsClient.field.${key}.helper`,
		riskLevel,
	});
}

export const SECURITY_POLICY_SETTINGS_SECTIONS: SectionDef[] = [
	{
		id: "securityPolicy",
		icon: "🚫",
		titleKey: "settingsClient.schema.section.securityPolicy.title",
		descriptionKey: "settingsClient.schema.section.securityPolicy.description",
		defaultOpen: true,
		layout: "grid-2",
		saveMessageKey: "settingsClient.schema.section.securityPolicy.saveMessage",
		fields: [
			knob("security.loginLockoutClientFailures", "5", 3, 50, "high"),
			knob("security.loginLockoutAccountFailures", "25", 5, 500, "high"),
			knob("security.loginLockoutMinutes", "15", 1, 1440, "high"),
			knob("security.rememberSessionTtlSeconds", "2592000", 3600, 31_536_000, "high"),
			{
				key: "security.sshEnforceHostKeyPin",
				labelKey: "settingsClient.field.security.sshEnforceHostKeyPin.label",
				type: "switch",
				defaultValue: "",
				helperTextKey: "settingsClient.field.security.sshEnforceHostKeyPin.helper",
				riskLevel: "high",
			},
		],
	},
];

export const OPERATIONS_SETTINGS_SECTIONS: SectionDef[] = [
	{
		id: "jobs",
		icon: "🧰",
		titleKey: "settingsClient.schema.section.jobs.title",
		descriptionKey: "settingsClient.schema.section.jobs.description",
		defaultOpen: true,
		layout: "grid-2",
		saveMessageKey: "settingsClient.schema.section.jobs.saveMessage",
		fields: [
			knob("jobs.defaultMaxAttempts", "3", 1, 10),
			knob("quickService.healthGateTimeoutMs", "90000", 10_000, 600_000),
		],
	},
];

export const ALERT_SETTINGS_SECTIONS: SectionDef[] = [
	{
		id: "alerts",
		icon: "🚨",
		titleKey: "settingsClient.schema.section.alerts.title",
		descriptionKey: "settingsClient.schema.section.alerts.description",
		defaultOpen: true,
		layout: "grid-2",
		saveMessageKey: "settingsClient.schema.section.alerts.saveMessage",
		fields: [
			knob("alerts.defaultEscalationMinutes", "30", 1, 1440),
			knob("alerts.notifyMaxAttempts", "8", 1, 20),
		],
	},
];

export const STORAGE_SETTINGS_SECTIONS: SectionDef[] = [
	{
		id: "storage",
		icon: "🗂️",
		titleKey: "settingsClient.schema.section.storage.title",
		descriptionKey: "settingsClient.schema.section.storage.description",
		defaultOpen: true,
		layout: "grid-2",
		saveMessageKey: "settingsClient.schema.section.storage.saveMessage",
		fields: [
			knob("storage.uploadMaxBytes", "2147483648", 1_048_576, 1_099_511_627_776, "high"),
			knob("storage.fileVersionKeep", "20", 1, 200),
			knob("storage.fileVersionMaxBytes", "52428800", 1_048_576, 1_073_741_824),
			knob("storage.contentSearchMaxFileBytes", "1048576", 65_536, 67_108_864),
		],
	},
];

export const MONITORING_SETTINGS_SECTIONS: SectionDef[] = [
	{
		id: "monitoring",
		icon: "📈",
		titleKey: "settingsClient.schema.section.monitoring.title",
		descriptionKey: "settingsClient.schema.section.monitoring.description",
		defaultOpen: true,
		layout: "grid-2",
		noticeBannerKey: "settingsClient.schema.section.monitoring.noticeBanner",
		saveMessageKey: "settingsClient.schema.section.monitoring.saveMessage",
		fields: [
			knob("monitoring.healthSampleIntervalMinutes", "5", 1, 60, "high"),
			knob("monitoring.capacityWindowHours", "168", 24, 720, "low"),
			knob("monitoring.capacityHorizonDays", "14", 1, 90, "low"),
		],
	},
	{
		id: "retention",
		icon: "🗑️",
		titleKey: "settingsClient.schema.section.retention.title",
		descriptionKey: "settingsClient.schema.section.retention.description",
		defaultOpen: true,
		layout: "grid-2",
		saveMessageKey: "settingsClient.schema.section.retention.saveMessage",
		fields: [
			knob("retention.auditLogDays", "365", 0, 3650, "high"),
			knob("retention.healthSamplesDays", "30", 1, 365),
			knob("retention.trafficSnapshotsDays", "14", 1, 365),
			knob("retention.terminalJobsDays", "30", 1, 365),
		],
	},
];

export const AI_SETTINGS_SECTIONS: SectionDef[] = [
	{
		id: "ai",
		icon: "🧠",
		titleKey: "settingsClient.schema.section.ai.title",
		descriptionKey: "settingsClient.schema.section.ai.description",
		defaultOpen: true,
		saveMessageKey: "settingsClient.schema.section.ai.saveMessage",
		fields: [knob("ai.knowledgeMaxResults", "8", 1, 20, "low")],
	},
];
