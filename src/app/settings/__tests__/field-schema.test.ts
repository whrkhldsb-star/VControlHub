import { describe, expect, it } from "vitest";

import {
	SETTINGS_SCHEMA,
	buildTocItems,
	getSectionSaveKeys,
	parseInteger,
} from "../field-schema";

describe("parseInteger", () => {
	it("returns null for a value within range", () => {
		expect(parseInteger("100", "X", 0, 200)).toBeNull();
		expect(parseInteger("0", "X", 0, 200)).toBeNull();
		expect(parseInteger("200", "X", 0, 200)).toBeNull();
	});

	it("rejects non-numeric values", () => {
		expect(parseInteger("abc", "端口", 1, 65535)).toBe("端口 必须是数字");
		// empty string parses to 0, which falls in the range check (not the parse check)
		expect(parseInteger("", "端口", 1, 65535)).toBe("端口 必须在 1 到 65535 之间");
	});

	it("rejects values below the minimum", () => {
		expect(parseInteger("299", "会话超时", 300, 2_592_000)).toBe("会话超时 必须在 300 到 2592000 之间");
	});

	it("rejects values above the maximum", () => {
		expect(parseInteger("65536", "端口", 1, 65535)).toBe("端口 必须在 1 到 65535 之间");
	});

	it("truncates floats before range checking", () => {
		expect(parseInteger("10.9", "X", 0, 100)).toBeNull();
		expect(parseInteger("100.1", "X", 0, 100)).toBeNull();
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

describe("buildTocItems", () => {
	it("emits one TOC entry per schema section in declaration order", () => {
		const items = buildTocItems();
		expect(items.map((i) => i.id)).toEqual(["2fa", "platform", "password", "runtime", "smtp"]);
	});

	it("strips the parenthetical suffix from the SMTP title for the TOC chip", () => {
		const items = buildTocItems();
		expect(items.find((i) => i.id === "smtp")?.title).toBe("邮件通知");
	});

	it("uses a custom subtitle for the 2FA section even though it has no fields", () => {
		const items = buildTocItems();
		expect(items.find((i) => i.id === "2fa")?.subtitle).toBe("两步验证");
	});

	it("uses field count as the subtitle for sections without a custom override", () => {
		const items = buildTocItems();
		// All 5 sections currently have a custom subtitle; verify them all explicitly.
		expect(items.find((i) => i.id === "2fa")?.subtitle).toBe("两步验证");
		expect(items.find((i) => i.id === "platform")?.subtitle).toBe("品牌 / Logo");
		expect(items.find((i) => i.id === "password")?.subtitle).toBe("超时 / 复杂度");
		expect(items.find((i) => i.id === "smtp")?.subtitle).toBe("SMTP / 告警收件人");
		expect(items.find((i) => i.id === "runtime")?.subtitle).toBe("命令 / SSH / 列表上限");
	});
});

describe("SMTP dynamic schema", () => {
	const smtp = SETTINGS_SCHEMA.find((s) => s.id === "smtp")!;
	const baseSettings: Record<string, string> = { "smtp.enabled": "false" };
	const enabledSettings: Record<string, string> = { "smtp.enabled": "true" };

	it("renders the '未启用' badge when smtp is off", () => {
		const badge = typeof smtp.badge === "function" ? smtp.badge(baseSettings) : smtp.badge;
		const tone = typeof smtp.badgeTone === "function" ? smtp.badgeTone(baseSettings) : smtp.badgeTone;
		expect(badge).toBe("未启用");
		expect(tone).toBe("slate");
	});

	it("flips the badge to '已启用' + emerald when smtp is on", () => {
		const badge = typeof smtp.badge === "function" ? smtp.badge(enabledSettings) : smtp.badge;
		const tone = typeof smtp.badgeTone === "function" ? smtp.badgeTone(enabledSettings) : smtp.badgeTone;
		expect(badge).toBe("已启用");
		expect(tone).toBe("emerald");
	});

	it("disables connection fields when smtp is off and enables them when on", () => {
		const hostField = smtp.fields.find((f) => f.key === "smtp.host")!;
		expect(hostField.disabled?.(baseSettings)).toBe(true);
		expect(hostField.disabled?.(enabledSettings)).toBe(false);
	});

	it("swaps the helper text for the port field based on smtp.enabled", () => {
		const portField = smtp.fields.find((f) => f.key === "smtp.port")!;
		const helperFn = portField.helperText as (s: Record<string, string>) => string | undefined;
		expect(helperFn(baseSettings)).toBe("启用 SMTP 后可编辑");
		expect(helperFn(enabledSettings)).toBe("1–65535；常用 465/587。");
	});

	it("validates alert recipients with a mix of separators", () => {
		const recipientsField = smtp.fields.find((f) => f.key === "smtp.alertRecipients")!;
		const validate = recipientsField.validate!;
		expect(validate("a@x.com, b@x.com; c@x.com", baseSettings)).toBeNull();
		expect(validate("a@x.com\nb@x.com", baseSettings)).toBeNull();
		expect(validate("a@x.com, not-an-email", baseSettings)).toContain("告警收件人地址格式不正确");
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
		expect(validate("1", {})).toBe("命令执行超时 必须在 5000 到 3600000 之间");
		expect(validate("3600001", {})).toBe("命令执行超时 必须在 5000 到 3600000 之间");
	});

	it("strips '(需重启)' parenthetical from the validation label", () => {
		const field = runtime.fields.find((f) => f.key === "runtime.commandReconcileIntervalMs")!;
		const validate = field.validate!;
		// Label is "命令维护扫描间隔（毫秒，需重启）"; validation uses "命令维护扫描间隔"
		expect(validate("1", {})).toBe("命令维护扫描间隔 必须在 5000 到 3600000 之间");
	});

	it("renders a notice banner explaining runtime value sources", () => {
		expect(runtime.noticeBanner).toContain("当前运行值来自数据库设置");
	});
});

describe("Schema declaration order", () => {
	it("matches the save-button order asserted by settings-client tests", () => {
		// settings-client.test.tsx asserts save button positions [0]=platform, [1]=password,
		// [2]=runtime, [3]=smtp. The schema must keep that order; if you reorder, also
		// update the test assertions.
		const saveable = SETTINGS_SCHEMA.filter((s) => !s.custom);
		expect(saveable.map((s) => s.id)).toEqual(["platform", "password", "runtime", "smtp"]);
	});
});

describe("SSH idle timeout (select field)", () => {
	const idleField = SETTINGS_SCHEMA.find((s) => s.id === "runtime")?.fields.find(
		(f) => f.key === "runtime.sshIdleTimeoutSec",
	);
	if (!idleField) throw new Error("runtime.sshIdleTimeoutSec field missing from schema");

	it("uses a select type with six presets", () => {
		expect(idleField.type).toBe("select");
		expect(idleField.options).toEqual([
			{ value: "0", label: "永不（强保活）" },
			{ value: "300", label: "5 分钟" },
			{ value: "600", label: "10 分钟" },
			{ value: "1800", label: "30 分钟" },
			{ value: "3600", label: "1 小时" },
			{ value: "7200", label: "2 小时" },
		]);
	});

	it("accepts '0' (永不) as a valid value", () => {
		expect(idleField.validate?.("0", {})).toBeNull();
	});

	it("accepts preset values within range", () => {
		expect(idleField.validate?.("300", {})).toBeNull();
		expect(idleField.validate?.("600", {})).toBeNull();
		expect(idleField.validate?.("7200", {})).toBeNull();
	});

	it("rejects sub-minute values", () => {
		expect(idleField.validate?.("30", {})).toMatch(/必须在 60 到 7200 秒之间/);
	});

	it("rejects values above 2 hours", () => {
		expect(idleField.validate?.("7201", {})).toMatch(/必须在 60 到 7200 秒之间/);
	});

	it("rejects non-numeric values", () => {
		expect(idleField.validate?.("abc", {})).toMatch(/必须是数字秒数/);
	});
});
