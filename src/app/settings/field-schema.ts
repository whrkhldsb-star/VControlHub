/**
 * Settings schema — declarative, i18n-keyed.
 *
 * All user-facing strings (titles, descriptions, labels, helpers,
 * placeholders, badges, save messages, notice banners, select option
 * labels, validate error keys) are stored as i18n dictionary keys.
 * The rendering layer resolves them via t(key) / tt(key, params).
 *
 * Adding a new setting:
 *   1. Backend: add setting key (service / dto / runtime-settings)
 *   2. Add a FieldDef to the appropriate section's fields[]
 *   3. Add the i18n keys to src/lib/i18n/dictionaries/settings-page.ts
 *   4. (Optional) For a new section, add a SectionDef to SETTINGS_SCHEMA
 *
 * Rendering order constraint: settings-client.test.tsx asserts save-button
 * order [0] platform / [1] password / [2] runtime / [3] smtp.
 */

export type FieldType = "text" | "number" | "password" | "select" | "switch" | "textarea";

export type SelectOption = {
	value: string;
	labelKey: string;
};

export type FieldRiskLevel = "low" | "medium" | "high";

export type FieldValidationError = {
	key: string;
	params?: Record<string, string | number>;
};

export type FieldDef = {
	key: string;
	labelKey: string;
	type: FieldType;
	placeholderKey?: string;
	defaultValue?: string;
	autoComplete?: string;
	options?: SelectOption[];
	helperTextKey?: string | ((settings: Record<string, string>) => string | undefined);
	min?: number;
	max?: number;
	validate?: (value: string, settings: Record<string, string>) => FieldValidationError | null;
	disabled?: (settings: Record<string, string>) => boolean;
	runtimeSummaryKey?: string;
	riskLevel?: FieldRiskLevel;
	rollbackable?: boolean;
};

export type BadgeTone = "cyan" | "emerald" | "amber" | "slate";

export type SectionLayout = "stack" | "grid-2";

export type SectionDef = {
	id: string;
	icon: string;
	titleKey: string;
	descriptionKey: string | ((settings: Record<string, string>) => string);
	badgeKey?: string | ((settings: Record<string, string>) => string);
	badgeTone?: BadgeTone | ((settings: Record<string, string>) => BadgeTone);
	defaultOpen: boolean;
	asForm?: boolean;
	layout?: SectionLayout;
	noticeBannerKey?: string;
	saveMessageKey: string;
	fields: FieldDef[];
	headerSwitchKey?: string;
	custom?: "two-factor";
};

/* ── Validate helpers ────────────────────────────────────── */

export function parseInteger(value: string, min: number, max: number): FieldValidationError | null {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return { key: "settingsClient.validate.parseInteger.notNumber" };
	const integer = Math.trunc(parsed);
	if (integer < min || integer > max) return { key: "settingsClient.validate.parseInteger.outOfRange", params: { min, max } };
	return null;
}

const isValidEmail = (s: string) => /^.+@.+\..+$/.test(s);

const validateLogoUrl = (value: string): FieldValidationError | null => {
	const trimmed = value.trim();
	if (!trimmed || trimmed.startsWith("/")) return null;
	try {
		const parsed = new URL(trimmed);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? null : { key: "settingsClient.validate.logoUrl.invalid" };
	} catch {
		return { key: "settingsClient.validate.logoUrl.invalid" };
	}
};

/* ── Factory ─────────────────────────────────────────────── */

function runtimeNumber(key: string, labelKey: string, defaultValue: string, min: number, max: number): FieldDef {
	return {
		key,
		labelKey,
		type: "number",
		defaultValue,
		min,
		max,
		validate: (value) => parseInteger(value, min, max),
	};
}

/* ── Schema ──────────────────────────────────────────────── */

const isSmtpDisabled = (s: Record<string, string>) => s["smtp.enabled"] !== "true";
const isTelegramDisabled = (s: Record<string, string>) => s["telegram.enabled"] !== "true";

export const SETTINGS_SCHEMA: SectionDef[] = [
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
	},
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
	},
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
	},
];

/* ── Helpers ────────────────────────────────────────────── */

export function getSectionSaveKeys(section: SectionDef): string[] {
	if (section.custom) return [];
	return section.fields.map((f) => f.key);
}
