import { isSmtpDisabled, isTelegramDisabled, isValidEmail, parseInteger, type SectionDef } from "./field-schema-core";

export const NOTIFICATION_SETTINGS_SECTIONS: SectionDef[] = [
	{
		id: "smtp",
		icon: "📧",
		titleKey: "settingsClient.schema.section.smtp.title",
		descriptionKey: (s) => (s["smtp.enabled"] === "true"
			? "settingsClient.schema.section.smtp.description.enabled"
			: "settingsClient.schema.section.smtp.description.disabled"),
		badgeKey: (s) => (s["smtp.enabled"] === "true" ? "settingsClient.schema.badge.enabled" : "settingsClient.schema.badge.disabled"),
		badgeTone: (s) => (s["smtp.enabled"] === "true" ? "emerald" : "slate"),
		defaultOpen: false,
		asForm: true,
		layout: "grid-2",
		saveMessageKey: "settingsClient.schema.section.smtp.saveMessage",
		headerSwitchKey: "smtp.enabled",
		fields: [
			{ key: "smtp.enabled", labelKey: "settingsClient.field.smtp.enabled.label", type: "switch" },
			{
				key: "smtp.host",
				labelKey: "settingsClient.field.smtp.host.label",
				type: "text",
				placeholderKey: "settingsClient.field.smtp.host.placeholder",
				disabled: isSmtpDisabled,
				helperTextKey: (s) => (isSmtpDisabled(s) ? "settingsClient.helper.smtp.disabledHint" : undefined),
			},
			{
				key: "smtp.port",
				labelKey: "settingsClient.field.smtp.port.label",
				type: "number",
				placeholderKey: "settingsClient.field.smtp.port.placeholder",
				min: 1,
				max: 65_535,
				disabled: isSmtpDisabled,
				helperTextKey: (s) => (isSmtpDisabled(s) ? "settingsClient.helper.smtp.disabledHint" : "settingsClient.field.smtp.port.helper.enabled"),
				validate: (value) => parseInteger(value || "587", 1, 65_535),
			},
			{
				key: "smtp.user",
				labelKey: "settingsClient.field.smtp.user.label",
				type: "text",
				placeholderKey: "settingsClient.field.smtp.user.placeholder",
				autoComplete: "username",
				disabled: isSmtpDisabled,
				helperTextKey: (s) => (isSmtpDisabled(s) ? "settingsClient.helper.smtp.disabledHint" : undefined),
			},
			{
				key: "smtp.pass",
				labelKey: "settingsClient.field.smtp.pass.label",
				type: "password",
				placeholderKey: "settingsClient.field.smtp.pass.placeholder",
				autoComplete: "new-password",
				disabled: isSmtpDisabled,
				helperTextKey: (s) => (isSmtpDisabled(s) ? "settingsClient.helper.smtp.disabledHint" : undefined),
				riskLevel: "high",
			},
			{
				key: "smtp.from",
				labelKey: "settingsClient.field.smtp.from.label",
				type: "text",
				placeholderKey: "settingsClient.field.smtp.from.placeholder",
				disabled: isSmtpDisabled,
				helperTextKey: (s) => (isSmtpDisabled(s) ? "settingsClient.helper.smtp.disabledHint" : "settingsClient.field.smtp.from.helper.enabled"),
				validate: (value) => (value.trim() && !isValidEmail(value.trim()) ? { key: "settingsClient.validate.smtp.from.invalid" } : null),
			},
			{
				key: "smtp.alertRecipients",
				labelKey: "settingsClient.field.smtp.alertRecipients.label",
				type: "text",
				placeholderKey: "settingsClient.field.smtp.alertRecipients.placeholder",
				disabled: isSmtpDisabled,
				helperTextKey: (s) => (isSmtpDisabled(s)
					? "settingsClient.helper.smtp.disabledHint"
					: "settingsClient.field.smtp.alertRecipients.helper.enabled"),
				validate: (value) => {
					const recipients = value.split(/[\n,;，；]+/).map((item) => item.trim()).filter(Boolean);
					const invalid = recipients.find((recipient) => !isValidEmail(recipient));
					return invalid ? { key: "settingsClient.validate.smtp.recipients.invalidPrefix", params: { invalid } } : null;
				},
			},
		],
	},
	{
		id: "telegram",
		icon: "💬",
		titleKey: "settingsClient.schema.section.telegram.title",
		descriptionKey: (s) => (s["telegram.enabled"] === "true"
			? "settingsClient.schema.section.telegram.description.enabled"
			: "settingsClient.schema.section.telegram.description.disabled"),
		badgeKey: (s) => (s["telegram.enabled"] === "true" ? "settingsClient.schema.badge.enabled" : "settingsClient.schema.badge.disabled"),
		badgeTone: (s) => (s["telegram.enabled"] === "true" ? "emerald" : "slate"),
		defaultOpen: false,
		asForm: true,
		layout: "grid-2",
		saveMessageKey: "settingsClient.schema.section.telegram.saveMessage",
		headerSwitchKey: "telegram.enabled",
		fields: [
			{ key: "telegram.enabled", labelKey: "settingsClient.field.telegram.enabled.label", type: "switch" },
			{
				key: "telegram.botToken",
				labelKey: "settingsClient.field.telegram.botToken.label",
				type: "password",
				placeholderKey: "settingsClient.field.telegram.botToken.placeholder",
				autoComplete: "off",
				disabled: isTelegramDisabled,
				helperTextKey: (s) => (isTelegramDisabled(s)
					? "settingsClient.helper.telegram.disabledHint"
					: "settingsClient.field.telegram.botToken.helper.enabled"),
				riskLevel: "high",
			},
			{
				key: "telegram.chatId",
				labelKey: "settingsClient.field.telegram.chatId.label",
				type: "textarea",
				placeholderKey: "settingsClient.field.telegram.chatId.placeholder",
				disabled: isTelegramDisabled,
				helperTextKey: (s) => (isTelegramDisabled(s)
					? "settingsClient.helper.telegram.disabledHint"
					: "settingsClient.field.telegram.chatId.helper.enabled"),
				validate: (value) => {
					const tokens = value
						.split(/[\n,;，；]+/)
						.map((item) => item.trim())
						.filter(Boolean);
					if (tokens.length === 0) return { key: "settingsClient.validate.telegram.chatId.required" };
					const invalid = tokens.find(
						(token) => !/^-?\d+$/.test(token) && !/^@[A-Za-z0-9_]{4,}$/.test(token),
					);
					return invalid ? { key: "settingsClient.validate.telegram.chatId.invalidPrefix", params: { invalid } } : null;
				},
			},
		],
	},
];
