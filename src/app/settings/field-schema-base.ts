import { parseInteger, runtimeNumber, validateLogoUrl, type SectionDef } from "./field-schema-core";

export const BASE_SETTINGS_SECTIONS: SectionDef[] = [
	{
		id: "2fa",
		icon: "🛡️",
		titleKey: "settingsClient.schema.section.twoFactor.title",
		descriptionKey: "settingsClient.schema.section.twoFactor.description",
		badgeKey: "settingsClient.schema.section.twoFactor.badge",
		defaultOpen: true,
		saveMessageKey: "",
		fields: [],
		custom: "two-factor",
	},
	{
		id: "platform",
		icon: "🌐",
		titleKey: "settingsClient.schema.section.platform.title",
		descriptionKey: "settingsClient.schema.section.platform.description",
		defaultOpen: true,
		saveMessageKey: "settingsClient.schema.section.platform.saveMessage",
		fields: [
			{
				key: "platform.name",
				labelKey: "settingsClient.field.platform.name.label",
				type: "text",
				placeholderKey: "settingsClient.field.platform.name.placeholder",
				helperTextKey: "settingsClient.field.platform.name.helper",
				validate: (value) => (value.trim() ? null : { key: "settingsClient.validate.platform.name.empty" }),
			},
			{
				key: "platform.logo",
				labelKey: "settingsClient.field.platform.logo.label",
				type: "text",
				placeholderKey: "settingsClient.field.platform.logo.placeholder",
				helperTextKey: "settingsClient.field.platform.logo.helper",
				validate: validateLogoUrl,
			},
		],
	},
	{
		id: "password",
		icon: "🔐",
		titleKey: "settingsClient.schema.section.password.title",
		descriptionKey: "settingsClient.schema.section.password.description",
		defaultOpen: true,
		saveMessageKey: "settingsClient.schema.section.password.saveMessage",
		fields: [
			{
				key: "session.timeout",
				labelKey: "settingsClient.field.session.timeout.label",
				type: "number",
				placeholderKey: "settingsClient.field.session.timeout.placeholder",
				min: 300,
				max: 2_592_000,
				helperTextKey: "settingsClient.field.session.timeout.helper",
				validate: (value) => parseInteger(value, 300, 2_592_000),
				riskLevel: "high",
			},
			{
				key: "password.minLength",
				labelKey: "settingsClient.field.password.minLength.label",
				type: "number",
				placeholderKey: "settingsClient.field.password.minLength.placeholder",
				min: 8,
				max: 128,
				helperTextKey: "settingsClient.field.password.minLength.helper",
				validate: (value) => parseInteger(value, 8, 128),
				riskLevel: "high",
			},
			{ key: "password.requireUppercase", labelKey: "settingsClient.field.password.requireUppercase.label", type: "switch", riskLevel: "medium" },
			{ key: "password.requireNumber", labelKey: "settingsClient.field.password.requireNumber.label", type: "switch", riskLevel: "medium" },
			{ key: "password.requireSpecial", labelKey: "settingsClient.field.password.requireSpecial.label", type: "switch", riskLevel: "medium" },
		],
	},
	{
		id: "runtime",
		icon: "⚙️",
		titleKey: "settingsClient.schema.section.runtime.title",
		descriptionKey: "settingsClient.schema.section.runtime.description",
		badgeKey: "settingsClient.schema.section.runtime.badge",
		defaultOpen: false,
		layout: "grid-2",
		noticeBannerKey: "settingsClient.schema.section.runtime.noticeBanner",
		saveMessageKey: "settingsClient.schema.section.runtime.saveMessage",
		fields: [
			Object.assign(runtimeNumber("runtime.commandExecutionTimeoutMs", "settingsClient.field.runtime.commandExecutionTimeoutMs.label", "300000", 5_000, 3_600_000), { riskLevel: "high" as const }),
			Object.assign(runtimeNumber("runtime.commandOutputLimitBytes", "settingsClient.field.runtime.commandOutputLimitBytes.label", "262144", 4_096, 10_485_760), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.commandStaleRunningAfterMs", "settingsClient.field.runtime.commandStaleRunningAfterMs.label", "600000", 30_000, 86_400_000), { riskLevel: "high" as const }),
			Object.assign(runtimeNumber("runtime.commandExecutionHeartbeatMs", "settingsClient.field.runtime.commandExecutionHeartbeatMs.label", "60000", 5_000, 600_000), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.commandReconcileIntervalMs", "settingsClient.field.runtime.commandReconcileIntervalMs.label", "60000", 5_000, 3_600_000), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.sftpSyncDirectoryTimeoutMs", "settingsClient.field.runtime.sftpSyncDirectoryTimeoutMs.label", "60000", 5_000, 1_800_000), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.sshWsHeartbeatIntervalMs", "settingsClient.field.runtime.sshWsHeartbeatIntervalMs.label", "25000", 5_000, 600_000), { riskLevel: "medium" as const }),
			{
				key: "runtime.sshIdleTimeoutSec",
				labelKey: "settingsClient.field.sshIdleTimeout.label",
				type: "select",
				defaultValue: "0",
				helperTextKey: "settingsClient.field.sshIdleTimeout.helper",
				options: [
					{ value: "0", labelKey: "settingsClient.option.sshIdle.0" },
					{ value: "300", labelKey: "settingsClient.option.sshIdle.300" },
					{ value: "600", labelKey: "settingsClient.option.sshIdle.600" },
					{ value: "1800", labelKey: "settingsClient.option.sshIdle.1800" },
					{ value: "3600", labelKey: "settingsClient.option.sshIdle.3600" },
					{ value: "7200", labelKey: "settingsClient.option.sshIdle.7200" },
				],
				validate: (value) => {
					if (value === "0") return null;
					const parsed = Number(value);
					if (!Number.isFinite(parsed)) return { key: "settingsClient.validate.sshIdle.notNumber" };
					const seconds = Math.trunc(parsed);
					if (seconds < 60 || seconds > 7200) return { key: "settingsClient.validate.sshIdle.outOfRange" };
					return null;
				},
				riskLevel: "high",
			},
			Object.assign(runtimeNumber("runtime.operationTaskListLimit", "settingsClient.field.runtime.operationTaskListLimit.label", "100", 20, 500), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.aiProviderListLimit", "settingsClient.field.runtime.aiProviderListLimit.label", "100", 10, 500), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.aiConversationListLimit", "settingsClient.field.runtime.aiConversationListLimit.label", "200", 20, 1_000), { riskLevel: "medium" as const }),
		],
	},];
