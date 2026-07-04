import { describe, expect, it } from "vitest";

import {
	SETTINGS_SCHEMA,
	getSectionSaveKeys,
	parseInteger,
} from "../field-schema";
import type { FieldValidationError } from "../field-schema";

describe("parseInteger", () => {
	it("returns null for a value within range", () => {
		expect(parseInteger("100", 0, 200)).toBeNull();
		expect(parseInteger("0", 0, 200)).toBeNull();
		expect(parseInteger("200", 0, 200)).toBeNull();
	});

	it("rejects non-numeric values with a structured error", () => {
		expect(parseInteger("abc", 1, 65535)).toEqual<FieldValidationError>({
			key: "settingsClient.validate.parseInteger.notNumber",
		});
		// empty string parses to 0, which falls in the range check (not the parse check)
		expect(parseInteger("", 1, 65535)).toEqual<FieldValidationError>({
			key: "settingsClient.validate.parseInteger.outOfRange",
			params: { min: 1, max: 65535 },
		});
	});

	it("rejects values below the minimum with min/max params", () => {
		expect(parseInteger("299", 300, 2_592_000)).toEqual<FieldValidationError>({
			key: "settingsClient.validate.parseInteger.outOfRange",
			params: { min: 300, max: 2_592_000 },
		});
	});

	it("rejects values above the maximum with min/max params", () => {
		expect(parseInteger("65536", 1, 65535)).toEqual<FieldValidationError>({
			key: "settingsClient.validate.parseInteger.outOfRange",
			params: { min: 1, max: 65535 },
		});
	});

	it("truncates floats before range checking", () => {
		expect(parseInteger("10.9", 0, 100)).toBeNull();
		expect(parseInteger("100.1", 0, 100)).toBeNull();
	});
});

describe("getSectionSaveKeys", () => {
	it("returns every field key for a non-custom section", () => {
		const platform = SETTINGS_SCHEMA.find((s) => s.id === "platform");
		expect(getSectionSaveKeys(platform!)).toEqual(["platform.name", "platform.logo"]);
	});

	it("returns runtime field keys in declaration order", () => {
		const runtime = SETTINGS_SCHEMA.find((s) => s.id === "runtime");
		expect(getSectionSaveKeys(runtime!)).toEqual([
			"runtime.commandExecutionTimeoutMs",
			"runtime.commandOutputLimitBytes",
			"runtime.commandStaleRunningAfterMs",
			"runtime.commandExecutionHeartbeatMs",
			"runtime.commandReconcileIntervalMs",
			"runtime.sftpSyncDirectoryTimeoutMs",
			"runtime.sshWsHeartbeatIntervalMs",
			"runtime.sshIdleTimeoutSec",
			"runtime.operationTaskListLimit",
			"runtime.aiProviderListLimit",
			"runtime.aiConversationListLimit",
		]);
	});

	it("returns smtp keys including header-switch key", () => {
		const smtp = SETTINGS_SCHEMA.find((s) => s.id === "smtp");
		expect(getSectionSaveKeys(smtp!)).toEqual([
			"smtp.enabled",
			"smtp.host",
			"smtp.port",
			"smtp.user",
			"smtp.pass",
			"smtp.from",
			"smtp.alertRecipients",
		]);
	});

	it("returns an empty array for the 2FA custom section", () => {
		const twoFactor = SETTINGS_SCHEMA.find((s) => s.id === "2fa");
		expect(getSectionSaveKeys(twoFactor!)).toEqual([]);
	});
});

describe("Schema uses i18n keys (no raw Chinese)", () => {
	it("all section titleKeys are i18n keys", () => {
		for (const section of SETTINGS_SCHEMA) {
			expect(section.titleKey).toMatch(/^settingsClient\./);
		}
	});

	it("all section saveMessageKeys are i18n keys or empty", () => {
		for (const section of SETTINGS_SCHEMA) {
			expect(section.saveMessageKey).toMatch(/^$|^settingsClient\./);
		}
	});

	it("all field labelKeys are i18n keys", () => {
		for (const section of SETTINGS_SCHEMA) {
			for (const field of section.fields) {
				expect(field.labelKey).toMatch(/^settingsClient\./);
			}
		}
	});

	it("all select option labelKeys are i18n keys", () => {
		for (const section of SETTINGS_SCHEMA) {
			for (const field of section.fields) {
				if (field.options) {
					for (const opt of field.options) {
						expect(opt.labelKey).toMatch(/^settingsClient\./);
					}
				}
			}
		}
	});
});

describe("SMTP dynamic schema", () => {
	const smtp = SETTINGS_SCHEMA.find((s) => s.id === "smtp")!;
	const baseSettings: Record<string, string> = { "smtp.enabled": "false" };
	const enabledSettings: Record<string, string> = { "smtp.enabled": "true" };

	it("renders the 'disabled' badgeKey when smtp is off", () => {
		const badgeKey = typeof smtp.badgeKey === "function" ? smtp.badgeKey(baseSettings) : smtp.badgeKey;
		const tone = typeof smtp.badgeTone === "function" ? smtp.badgeTone(baseSettings) : smtp.badgeTone;
		expect(badgeKey).toBe("settingsClient.schema.badge.disabled");
		expect(tone).toBe("slate");
	});

	it("flips the badgeKey to 'enabled' + emerald when smtp is on", () => {
		const badgeKey = typeof smtp.badgeKey === "function" ? smtp.badgeKey(enabledSettings) : smtp.badgeKey;
		const tone = typeof smtp.badgeTone === "function" ? smtp.badgeTone(enabledSettings) : smtp.badgeTone;
		expect(badgeKey).toBe("settingsClient.schema.badge.enabled");
		expect(tone).toBe("emerald");
	});

	it("disables connection fields when smtp is off and enables them when on", () => {
		const hostField = smtp.fields.find((f) => f.key === "smtp.host")!;
		expect(hostField.disabled?.(baseSettings)).toBe(true);
		expect(hostField.disabled?.(enabledSettings)).toBe(false);
	});

	it("swaps the helperTextKey for the port field based on smtp.enabled", () => {
		const portField = smtp.fields.find((f) => f.key === "smtp.port")!;
		const helperFn = portField.helperTextKey as (s: Record<string, string>) => string | undefined;
		expect(helperFn(baseSettings)).toBe("settingsClient.helper.smtp.disabledHint");
		expect(helperFn(enabledSettings)).toBe("settingsClient.field.smtp.port.helper.enabled");
	});

	it("validates alert recipients with a mix of separators", () => {
		const recipientsField = smtp.fields.find((f) => f.key === "smtp.alertRecipients")!;
		const validate = recipientsField.validate!;
		expect(validate("a@x.com, b@x.com; c@x.com", baseSettings)).toBeNull();
		expect(validate("a@x.com\nb@x.com", baseSettings)).toBeNull();
		const err = validate("a@x.com, not-an-email", baseSettings);
		expect(err?.key).toBe("settingsClient.validate.smtp.recipients.invalidPrefix");
		expect(err?.params?.invalid).toBe("not-an-email");
	});
});

describe("Runtime schema", () => {
	const runtime = SETTINGS_SCHEMA.find((s) => s.id === "runtime")!;

	it("declares 11 runtime fields (10 number + 1 select)", () => {
		expect(runtime.fields).toHaveLength(11);
		const selectFields = runtime.fields.filter((f) => f.type === "select");
		expect(selectFields).toHaveLength(1);
		expect(selectFields[0]?.key).toBe("runtime.sshIdleTimeoutSec");
	});

	it("validates command execution timeout bounds (5000–3600000)", () => {
		const field = runtime.fields.find((f) => f.key === "runtime.commandExecutionTimeoutMs")!;
		const validate = field.validate!;
		expect(validate("300000", {})).toBeNull();
		expect(validate("1", {})).toEqual<FieldValidationError>({
			key: "settingsClient.validate.parseInteger.outOfRange",
			params: { min: 5_000, max: 3_600_000 },
		});
		expect(validate("3600001", {})).toEqual<FieldValidationError>({
			key: "settingsClient.validate.parseInteger.outOfRange",
			params: { min: 5_000, max: 3_600_000 },
		});
	});

	it("uses the same parseInteger error structure for reconcile interval", () => {
		const field = runtime.fields.find((f) => f.key === "runtime.commandReconcileIntervalMs")!;
		const validate = field.validate!;
		expect(validate("1", {})).toEqual<FieldValidationError>({
			key: "settingsClient.validate.parseInteger.outOfRange",
			params: { min: 5_000, max: 3_600_000 },
		});
	});

	it("has a noticeBannerKey pointing to the runtime notice banner", () => {
		expect(runtime.noticeBannerKey).toBe("settingsClient.schema.section.runtime.noticeBanner");
	});
});

describe("Schema declaration order", () => {
	it("matches the save-button order asserted by settings-client tests", () => {
		const saveable = SETTINGS_SCHEMA.filter((s) => !s.custom);
		expect(saveable.map((s) => s.id)).toEqual(["platform", "password", "runtime", "smtp", "telegram", "dashboard", "offsite", "aiOps"]);
	});
});

describe("SSH idle timeout (select field)", () => {
	const idleField = SETTINGS_SCHEMA.find((s) => s.id === "runtime")?.fields.find(
		(f) => f.key === "runtime.sshIdleTimeoutSec",
	);
	if (!idleField) throw new Error("runtime.sshIdleTimeoutSec field missing from schema");

	it("uses a select type with six presets (labelKey, not raw label)", () => {
		expect(idleField.type).toBe("select");
		expect(idleField.options).toEqual([
			{ value: "0", labelKey: "settingsClient.option.sshIdle.0" },
			{ value: "300", labelKey: "settingsClient.option.sshIdle.300" },
			{ value: "600", labelKey: "settingsClient.option.sshIdle.600" },
			{ value: "1800", labelKey: "settingsClient.option.sshIdle.1800" },
			{ value: "3600", labelKey: "settingsClient.option.sshIdle.3600" },
			{ value: "7200", labelKey: "settingsClient.option.sshIdle.7200" },
		]);
	});

	it("accepts '0' as a valid value", () => {
		expect(idleField.validate?.("0", {})).toBeNull();
	});

	it("accepts preset values within range", () => {
		expect(idleField.validate?.("300", {})).toBeNull();
		expect(idleField.validate?.("600", {})).toBeNull();
		expect(idleField.validate?.("7200", {})).toBeNull();
	});

	it("rejects sub-minute values with outOfRange key", () => {
		expect(idleField.validate?.("30", {})).toEqual<FieldValidationError>({
			key: "settingsClient.validate.sshIdle.outOfRange",
		});
	});

	it("rejects values above 2 hours with outOfRange key", () => {
		expect(idleField.validate?.("7201", {})).toEqual<FieldValidationError>({
			key: "settingsClient.validate.sshIdle.outOfRange",
		});
	});

	it("rejects non-numeric values with notNumber key", () => {
		expect(idleField.validate?.("abc", {})).toEqual<FieldValidationError>({
			key: "settingsClient.validate.sshIdle.notNumber",
		});
	});
});
