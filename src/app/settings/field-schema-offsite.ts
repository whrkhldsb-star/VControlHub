import { isValidEmail, parseInteger, type SectionDef } from "./field-schema-core";

export const DASHBOARD_SETTINGS_SECTIONS: SectionDef[] = [
	{
		id: "dashboard",
		icon: "🧩",
		titleKey: "settingsClient.schema.section.dashboard.title",
		descriptionKey: "settingsClient.schema.section.dashboard.description",
		defaultOpen: false,
		saveMessageKey: "settingsClient.schema.section.dashboard.saveMessage",
		fields: [
			{
				key: "dashboard.layout.dragReorderEnabled",
				labelKey: "settingsClient.field.dashboard.layout.dragReorderEnabled.label",
				type: "switch",
				defaultValue: "true",
				helperTextKey: "settingsClient.field.dashboard.layout.dragReorderEnabled.helper",
			},
		],
	}
];

export const OFFSITE_SETTINGS_SECTIONS: SectionDef[] = [
	{
		id: "offsite",
		icon: "☁️",
		titleKey: "settingsClient.schema.section.offsite.title",
		descriptionKey: (s) => (s["offsite.enabled"] === "true"
			? "settingsClient.schema.section.offsite.description.enabled"
			: "settingsClient.schema.section.offsite.description.disabled"),
		badgeKey: (s) => (s["offsite.enabled"] === "true" ? "settingsClient.schema.badge.enabled" : "settingsClient.schema.badge.disabled"),
		badgeTone: (s) => (s["offsite.enabled"] === "true" ? "emerald" : "slate"),
		defaultOpen: false,
		asForm: true,
		layout: "grid-2",
		headerSwitchKey: "offsite.enabled",
		noticeBannerKey: "settingsClient.schema.section.offsite.noticeBanner",
		saveMessageKey: "settingsClient.schema.section.offsite.saveMessage",
		fields: [
			{ key: "offsite.enabled", labelKey: "settingsClient.field.offsite.enabled.label", type: "switch" },
			{
				key: "offsite.provider",
				labelKey: "settingsClient.field.offsite.provider.label",
				type: "select",
				defaultValue: "s3",
				options: [
					{ value: "s3", labelKey: "settingsClient.option.offsite.provider.s3" },
					{ value: "r2", labelKey: "settingsClient.option.offsite.provider.r2" },
					{ value: "b2", labelKey: "settingsClient.option.offsite.provider.b2" },
					{ value: "minio", labelKey: "settingsClient.option.offsite.provider.minio" },
				],
				helperTextKey: "settingsClient.field.offsite.provider.helper",
			},
			{
				key: "offsite.endpoint",
				labelKey: "settingsClient.field.offsite.endpoint.label",
				type: "text",
				placeholderKey: "settingsClient.field.offsite.endpoint.placeholder",
				helperTextKey: "settingsClient.field.offsite.endpoint.helper",
			},
			{
				key: "offsite.region",
				labelKey: "settingsClient.field.offsite.region.label",
				type: "text",
				placeholderKey: "settingsClient.field.offsite.region.placeholder",
				helperTextKey: "settingsClient.field.offsite.region.helper",
			},
			{
				key: "offsite.bucket",
				labelKey: "settingsClient.field.offsite.bucket.label",
				type: "text",
				placeholderKey: "settingsClient.field.offsite.bucket.placeholder",
				helperTextKey: "settingsClient.field.offsite.bucket.helper",
			},
			{
				key: "offsite.accessKeyId",
				labelKey: "settingsClient.field.offsite.accessKeyId.label",
				type: "text",
				placeholderKey: "settingsClient.field.offsite.accessKeyId.placeholder",
				helperTextKey: "settingsClient.field.offsite.accessKeyId.helper",
				riskLevel: "high",
			},
			{
				key: "offsite.secretAccessKey",
				labelKey: "settingsClient.field.offsite.secretAccessKey.label",
				type: "password",
				placeholderKey: "settingsClient.field.offsite.secretAccessKey.placeholder",
				autoComplete: "new-password",
				helperTextKey: "settingsClient.field.offsite.secretAccessKey.helper",
				riskLevel: "high",
			},
			{
				key: "offsite.pathPrefix",
				labelKey: "settingsClient.field.offsite.pathPrefix.label",
				type: "text",
				placeholderKey: "settingsClient.field.offsite.pathPrefix.placeholder",
				helperTextKey: "settingsClient.field.offsite.pathPrefix.helper",
				validate: (value) => {
					const trimmed = value.trim();
					if (!trimmed) return null;
					return trimmed.endsWith("/") ? null : { key: "settingsClient.validate.offsite.pathPrefix.noSlash" };
				},
			},
			{
				key: "offsite.dailyWindowHour",
				labelKey: "settingsClient.field.offsite.dailyWindowHour.label",
				type: "number",
				placeholderKey: "settingsClient.field.offsite.dailyWindowHour.placeholder",
				min: 0,
				max: 23,
				helperTextKey: "settingsClient.field.offsite.dailyWindowHour.helper",
				validate: (value) => parseInteger(value || "3", 0, 23),
			},
			{
				key: "offsite.retentionDays",
				labelKey: "settingsClient.field.offsite.retentionDays.label",
				type: "number",
				placeholderKey: "settingsClient.field.offsite.retentionDays.placeholder",
				min: 1,
				max: 3650,
				helperTextKey: "settingsClient.field.offsite.retentionDays.helper",
				validate: (value) => parseInteger(value || "30", 1, 3650),
			},
			{
				key: "offsite.failureAlertRecipient",
				labelKey: "settingsClient.field.offsite.failureAlertRecipient.label",
				type: "text",
				placeholderKey: "settingsClient.field.offsite.failureAlertRecipient.placeholder",
				helperTextKey: "settingsClient.field.offsite.failureAlertRecipient.helper",
				validate: (value) => {
					const trimmed = value.trim();
					if (!trimmed) return null;
					return isValidEmail(trimmed) ? null : { key: "settingsClient.validate.offsite.failureRecipient.invalid" };
				},
			},
		],
	},
];

export const AI_OPS_SETTINGS_SECTIONS: SectionDef[] = [
	{
		id: "aiOps",
		icon: "🤖",
		titleKey: "settingsClient.schema.section.aiOps.title",
		descriptionKey: (s) => (s["ai.ops.mode"] === "autonomous"
			? "settingsClient.schema.section.aiOps.description.autonomous"
			: "settingsClient.schema.section.aiOps.description.recommendation"),
		badgeKey: (s) => (s["ai.ops.mode"] === "autonomous" ? "settingsClient.schema.badge.aiOps.autonomous" : "settingsClient.schema.badge.aiOps.recommendation"),
		badgeTone: (s) => (s["ai.ops.mode"] === "autonomous" ? "amber" : "cyan"),
		defaultOpen: false,
		saveMessageKey: "settingsClient.schema.section.aiOps.saveMessage",
		fields: [
			{
				key: "ai.ops.mode",
				labelKey: "settingsClient.field.ai.ops.mode.label",
				type: "select",
				defaultValue: "recommendation",
				options: [
					{ value: "recommendation", labelKey: "settingsClient.option.aiOps.mode.recommendation" },
					{ value: "autonomous", labelKey: "settingsClient.option.aiOps.mode.autonomous" },
				],
				helperTextKey: "settingsClient.field.ai.ops.mode.helper",
				riskLevel: "high",
			},
			{
				key: "ai.ops.provider",
				labelKey: "settingsClient.field.ai.ops.provider.label",
				type: "text",
				defaultValue: "",
				placeholderKey: "settingsClient.field.ai.ops.provider.placeholder",
				helperTextKey: "settingsClient.field.ai.ops.provider.helper",
			},
		],
	}
];
