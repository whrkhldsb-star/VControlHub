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

export const isValidEmail = (s: string) => /^.+@.+\..+$/.test(s);

export const validateLogoUrl = (value: string): FieldValidationError | null => {
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

export function runtimeNumber(key: string, labelKey: string, defaultValue: string, min: number, max: number): FieldDef {
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

export const isSmtpDisabled = (s: Record<string, string>) => s["smtp.enabled"] !== "true";
export const isTelegramDisabled = (s: Record<string, string>) => s["telegram.enabled"] !== "true";
