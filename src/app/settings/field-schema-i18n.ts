/**
 * Settings schema i18n bridge.
 *
 * The declarative `SETTINGS_SCHEMA` const in `./field-schema.ts` keeps zh
 * strings inline so that legacy callers, tests, and validate functions can
 * rely on stable zh error messages without coupling to the i18n layer.
 *
 * This module projects the schema into a translated shape for the UI:
 *   - title / description / saveMessage / noticeBanner / badge (static + dynamic)
 *   - field label / placeholder / helperText (static + dynamic, settings-aware)
 *   - select option label
 *   - TOC subtitle / title-short
 *
 * The output is a deep clone (validated functions are preserved by reference)
 * so callers cannot mutate the original const. Validate functions remain
 * zh-only by design (zh error messages match the assertions in
 * `__tests__/field-schema.test.ts`); if validate errors ever need
 * internationalization, that change should happen alongside the const.
 */

import {
	SETTINGS_SCHEMA,
	type FieldDef,
	type SectionDef,
	/* eslint-disable @typescript-eslint/no-unused-vars -- re-exported types kept for downstream consumers */
	type SectionLayout,
	type FieldType,
	type FieldRiskLevel,
	type BadgeTone,
	/* eslint-enable @typescript-eslint/no-unused-vars */
	type SelectOption,
} from "./field-schema";

export type Translator = (key: string) => string;

/**
 * Translate a `string | ((settings) => string)` into a function that always
 * returns a translated string. Falls back to the original function when no
 * translation key is provided.
 */
function resolveKeyedString(
	value: string | ((settings: Record<string, string>) => string | undefined),
	key: string | ((settings: Record<string, string>) => string) | undefined,
	t: Translator,
): string | ((settings: Record<string, string>) => string | undefined) {
	if (typeof value === "function") {
		// Dynamic helper text / description / badge. If a key function is
		// provided it must take the same settings arg and return a translated
		// string for the dynamic branch.
		if (typeof key === "function") {
			return (settings: Record<string, string>) => t(key(settings));
		}
		return value;
	}
	if (typeof key === "function") {
		return (settings: Record<string, string>) => t(key(settings));
	}
	if (typeof key === "string") {
		return t(key);
	}
	return value;
}

type FieldKeyMap = Partial<{
	label: string;
	helperText: string | ((settings: Record<string, string>) => string);
	placeholder: string;
}>;

type SectionKeyMap = Partial<{
	title: string;
	description: string | ((settings: Record<string, string>) => string);
	saveMessage: string;
	noticeBanner: string;
	badge: string | ((settings: Record<string, string>) => string);
}>;

const SECTION_KEYS: Record<string, SectionKeyMap> = {
	"2fa": {
		title: "settingsClient.schema.section.twoFactor.title",
		description: "settingsClient.schema.section.twoFactor.description",
	},
	platform: {
		title: "settingsClient.schema.section.platform.title",
		description: "settingsClient.schema.section.platform.description",
		saveMessage: "settingsClient.schema.section.platform.saveMessage",
	},
	password: {
		title: "settingsClient.schema.section.password.title",
		description: "settingsClient.schema.section.password.description",
		saveMessage: "settingsClient.schema.section.password.saveMessage",
	},
	runtime: {
		title: "settingsClient.schema.section.runtime.title",
		description: "settingsClient.schema.section.runtime.description",
		saveMessage: "settingsClient.schema.section.runtime.saveMessage",
		noticeBanner: "settingsClient.schema.section.runtime.noticeBanner",
		badge: "settingsClient.schema.section.runtime.badge",
	},
	smtp: {
		title: "settingsClient.schema.section.smtp.title",
		description: (s: Record<string, string>) =>
			s["smtp.enabled"] === "true"
				? "settingsClient.schema.section.smtp.description.enabled"
				: "settingsClient.schema.section.smtp.description.disabled",
		saveMessage: "settingsClient.schema.section.smtp.saveMessage",
		badge: (s: Record<string, string>) =>
			s["smtp.enabled"] === "true"
				? "settingsClient.schema.badge.enabled"
				: "settingsClient.schema.badge.disabled",
	},
	telegram: {
		title: "settingsClient.schema.section.telegram.title",
		description: (s: Record<string, string>) =>
			s["telegram.enabled"] === "true"
				? "settingsClient.schema.section.telegram.description.enabled"
				: "settingsClient.schema.section.telegram.description.disabled",
		saveMessage: "settingsClient.schema.section.telegram.saveMessage",
		badge: (s: Record<string, string>) =>
			s["telegram.enabled"] === "true"
				? "settingsClient.schema.badge.enabled"
				: "settingsClient.schema.badge.disabled",
	},
	dashboard: {
		title: "settingsClient.schema.section.dashboard.title",
		description: "settingsClient.schema.section.dashboard.description",
		saveMessage: "settingsClient.schema.section.dashboard.saveMessage",
	},
	offsite: {
		title: "settingsClient.schema.section.offsite.title",
		description: (s: Record<string, string>) =>
			s["offsite.enabled"] === "true"
				? "settingsClient.schema.section.offsite.description.enabled"
				: "settingsClient.schema.section.offsite.description.disabled",
		saveMessage: "settingsClient.schema.section.offsite.saveMessage",
		noticeBanner: "settingsClient.schema.section.offsite.noticeBanner",
		badge: (s: Record<string, string>) =>
			s["offsite.enabled"] === "true"
				? "settingsClient.schema.badge.enabled"
				: "settingsClient.schema.badge.disabled",
	},
	aiOps: {
		title: "settingsClient.schema.section.aiOps.title",
		description: (s: Record<string, string>) =>
			s["ai.ops.mode"] === "autonomous"
				? "settingsClient.schema.section.aiOps.description.autonomous"
				: "settingsClient.schema.section.aiOps.description.recommendation",
		saveMessage: "settingsClient.schema.section.aiOps.saveMessage",
		badge: (s: Record<string, string>) =>
			s["ai.ops.mode"] === "autonomous"
				? "settingsClient.schema.badge.aiOps.autonomous"
				: "settingsClient.schema.badge.aiOps.recommendation",
	},
};

const FIELD_KEYS: Record<string, FieldKeyMap> = {
	"platform.name": { label: "settingsClient.field.platform.name.label", placeholder: "settingsClient.field.platform.name.placeholder", helperText: "settingsClient.field.platform.name.helper" },
	"platform.logo": { label: "settingsClient.field.platform.logo.label", placeholder: "settingsClient.field.platform.logo.placeholder", helperText: "settingsClient.field.platform.logo.helper" },
	"session.timeout": { label: "settingsClient.field.session.timeout.label", placeholder: "settingsClient.field.session.timeout.placeholder", helperText: "settingsClient.field.session.timeout.helper" },
	"password.minLength": { label: "settingsClient.field.password.minLength.label", placeholder: "settingsClient.field.password.minLength.placeholder", helperText: "settingsClient.field.password.minLength.helper" },
	"password.requireUppercase": { label: "settingsClient.field.password.requireUppercase.label" },
	"password.requireNumber": { label: "settingsClient.field.password.requireNumber.label" },
	"password.requireSpecial": { label: "settingsClient.field.password.requireSpecial.label" },
	"runtime.sshIdleTimeoutSec": { label: "settingsClient.field.sshIdleTimeout.label", helperText: "settingsClient.field.sshIdleTimeout.helper" },
	"smtp.enabled": { label: "settingsClient.field.smtp.enabled.label" },
	"smtp.host": { label: "settingsClient.field.smtp.host.label", placeholder: "settingsClient.field.smtp.host.placeholder" },
	"smtp.port": { label: "settingsClient.field.smtp.port.label", placeholder: "settingsClient.field.smtp.port.placeholder", helperText: (s: Record<string, string>) => (s["smtp.enabled"] !== "true" ? "settingsClient.helper.smtp.disabledHint" : "settingsClient.field.smtp.port.helper.enabled") },
	"smtp.user": { label: "settingsClient.field.smtp.user.label", placeholder: "settingsClient.field.smtp.user.placeholder" },
	"smtp.pass": { label: "settingsClient.field.smtp.pass.label", placeholder: "settingsClient.field.smtp.pass.placeholder" },
	"smtp.from": { label: "settingsClient.field.smtp.from.label", placeholder: "settingsClient.field.smtp.from.placeholder", helperText: (s: Record<string, string>) => (s["smtp.enabled"] !== "true" ? "settingsClient.helper.smtp.disabledHint" : "settingsClient.field.smtp.from.helper.enabled") },
	"smtp.alertRecipients": { label: "settingsClient.field.smtp.alertRecipients.label", placeholder: "settingsClient.field.smtp.alertRecipients.placeholder", helperText: (s: Record<string, string>) => (s["smtp.enabled"] !== "true" ? "settingsClient.helper.smtp.disabledHint" : "settingsClient.field.smtp.alertRecipients.helper.enabled") },
	"telegram.enabled": { label: "settingsClient.field.telegram.enabled.label" },
	"telegram.botToken": { label: "settingsClient.field.telegram.botToken.label", placeholder: "settingsClient.field.telegram.botToken.placeholder", helperText: (s: Record<string, string>) => (s["telegram.enabled"] !== "true" ? "settingsClient.helper.telegram.disabledHint" : "settingsClient.field.telegram.botToken.helper.enabled") },
	"telegram.chatId": { label: "settingsClient.field.telegram.chatId.label", placeholder: "settingsClient.field.telegram.chatId.placeholder", helperText: (s: Record<string, string>) => (s["telegram.enabled"] !== "true" ? "settingsClient.helper.telegram.disabledHint" : "settingsClient.field.telegram.chatId.helper.enabled") },
	"dashboard.layout.dragReorderEnabled": { label: "settingsClient.field.dashboard.layout.dragReorderEnabled.label", helperText: "settingsClient.field.dashboard.layout.dragReorderEnabled.helper" },
	"offsite.enabled": { label: "settingsClient.field.offsite.enabled.label" },
	"offsite.provider": { label: "settingsClient.field.offsite.provider.label", helperText: "settingsClient.field.offsite.provider.helper" },
	"offsite.endpoint": { label: "settingsClient.field.offsite.endpoint.label", placeholder: "settingsClient.field.offsite.endpoint.placeholder", helperText: "settingsClient.field.offsite.endpoint.helper" },
	"offsite.region": { label: "settingsClient.field.offsite.region.label", placeholder: "settingsClient.field.offsite.region.placeholder", helperText: "settingsClient.field.offsite.region.helper" },
	"offsite.bucket": { label: "settingsClient.field.offsite.bucket.label", placeholder: "settingsClient.field.offsite.bucket.placeholder", helperText: "settingsClient.field.offsite.bucket.helper" },
	"offsite.accessKeyId": { label: "settingsClient.field.offsite.accessKeyId.label", placeholder: "settingsClient.field.offsite.accessKeyId.placeholder", helperText: "settingsClient.field.offsite.accessKeyId.helper" },
	"offsite.secretAccessKey": { label: "settingsClient.field.offsite.secretAccessKey.label", placeholder: "settingsClient.field.offsite.secretAccessKey.placeholder", helperText: "settingsClient.field.offsite.secretAccessKey.helper" },
	"offsite.pathPrefix": { label: "settingsClient.field.offsite.pathPrefix.label", placeholder: "settingsClient.field.offsite.pathPrefix.placeholder", helperText: "settingsClient.field.offsite.pathPrefix.helper" },
	"offsite.dailyWindowHour": { label: "settingsClient.field.offsite.dailyWindowHour.label", placeholder: "settingsClient.field.offsite.dailyWindowHour.placeholder", helperText: "settingsClient.field.offsite.dailyWindowHour.helper" },
	"offsite.retentionDays": { label: "settingsClient.field.offsite.retentionDays.label", placeholder: "settingsClient.field.offsite.retentionDays.placeholder", helperText: "settingsClient.field.offsite.retentionDays.helper" },
	"offsite.failureAlertRecipient": { label: "settingsClient.field.offsite.failureAlertRecipient.label", placeholder: "settingsClient.field.offsite.failureAlertRecipient.placeholder", helperText: "settingsClient.field.offsite.failureAlertRecipient.helper" },
	"ai.ops.mode": { label: "settingsClient.field.ai.ops.mode.label", helperText: "settingsClient.field.ai.ops.mode.helper" },
	"ai.ops.provider": { label: "settingsClient.field.ai.ops.provider.label", placeholder: "settingsClient.field.ai.ops.provider.placeholder", helperText: "settingsClient.field.ai.ops.provider.helper" },
};

const SELECT_OPTION_KEYS: Record<string, Record<string, string>> = {
	"runtime.sshIdleTimeoutSec": {
		"0": "settingsClient.option.sshIdle.0",
		"300": "settingsClient.option.sshIdle.300",
		"600": "settingsClient.option.sshIdle.600",
		"1800": "settingsClient.option.sshIdle.1800",
		"3600": "settingsClient.option.sshIdle.3600",
		"7200": "settingsClient.option.sshIdle.7200",
	},
	"offsite.provider": {
		s3: "settingsClient.option.offsite.provider.s3",
		r2: "settingsClient.option.offsite.provider.r2",
		b2: "settingsClient.option.offsite.provider.b2",
		minio: "settingsClient.option.offsite.provider.minio",
	},
	"ai.ops.mode": {
		recommendation: "settingsClient.option.aiOps.mode.recommendation",
		autonomous: "settingsClient.option.aiOps.mode.autonomous",
	},
};

function translateSelectOptions(fieldKey: string, t: Translator): SelectOption[] | undefined {
	const map = SELECT_OPTION_KEYS[fieldKey];
	if (!map) return undefined;
	return Object.entries(map).map(([value, key]) => ({ value, label: t(key) }));
}

function translateField(field: FieldDef, t: Translator): FieldDef {
	const keyMap = FIELD_KEYS[field.key] ?? {};
	const options = translateSelectOptions(field.key, t) ?? field.options;
	const next: FieldDef = {
		...field,
		label: keyMap.label ? t(keyMap.label) : field.label,
		options,
	};
	if (keyMap.placeholder) {
		next.placeholder = t(keyMap.placeholder);
	}
	if (keyMap.helperText !== undefined) {
		next.helperText = resolveKeyedString(
			field.helperText ?? "",
			keyMap.helperText,
			t,
		) as FieldDef["helperText"];
	}
	return next;
}

function translateSection(section: SectionDef, t: Translator): SectionDef {
	const keyMap = SECTION_KEYS[section.id] ?? {};
	const next: SectionDef = {
		...section,
		title: keyMap.title ? t(keyMap.title) : section.title,
		description: resolveKeyedString(section.description, keyMap.description, t) as SectionDef["description"],
		fields: section.fields.map((f) => translateField(f, t)),
	};
	if (keyMap.saveMessage) next.saveMessage = t(keyMap.saveMessage);
	if (keyMap.noticeBanner) next.noticeBanner = t(keyMap.noticeBanner);
	if (keyMap.badge !== undefined) {
		next.badge = resolveKeyedString(section.badge ?? "", keyMap.badge, t) as SectionDef["badge"];
	}
	return next;
}

export function getSettingsSchema(t: Translator): SectionDef[] {
	return SETTINGS_SCHEMA.map((s) => translateSection(s, t));
}

const TOC_SUBTITLE_KEYS: Record<string, string> = {
	"2fa": "settingsClient.toc.twoFactor.subtitle",
	platform: "settingsClient.toc.platform.subtitle",
	password: "settingsClient.toc.password.subtitle",
	smtp: "settingsClient.toc.smtp.subtitle",
	telegram: "settingsClient.toc.telegram.subtitle",
	runtime: "settingsClient.toc.runtime.subtitle",
	dashboard: "settingsClient.toc.dashboard.subtitle",
	offsite: "settingsClient.toc.offsite.subtitle",
	aiOps: "settingsClient.toc.aiOps.subtitle",
};

export function getTocItems(t: Translator): { id: string; icon: string; title: string; subtitle: string }[] {
	const schema = getSettingsSchema(t);
	return schema.map((s) => ({
		id: s.id,
		icon: s.icon,
		title: s.id === "smtp" ? t("settingsClient.toc.smtp.titleShort") : s.title,
		subtitle: TOC_SUBTITLE_KEYS[s.id] ? t(TOC_SUBTITLE_KEYS[s.id] as string) : `${s.fields.length}${t("settingsClient.toc.fieldsCount.suffix")}`,
	}));
}
