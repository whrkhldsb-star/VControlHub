/**
 * 设置页字段配置（声明式 schema）
 *
 * 加新设置项的成本：
 *   1. 后端补 setting key（service / dto / runtime-settings）
 *   2. 在这里 SETTINGS_SCHEMA 找到对应分组的 fields[] 加一行
 *   3. （可选）如果是新分组，在 SETTINGS_SCHEMA 数组顶层加一个 SectionDef
 *
 * 不再需要：
 *   - 在 RUNTIME_NUMBER_RULES 里加一行
 *   - 在 SECTION_KEYS 里同步 key 列表
 *   - 在 settings-client.tsx 的 JSX 里手写一组 <Field>
 *   - 在每个 section 的 SaveButton onClick 里手写 keys 数组
 *
 * 渲染顺序约束：settings-client.test.tsx 假设保存按钮顺序为
 *   [0] platform / [1] password / [2] runtime / [3] smtp
 * 修改 SETTINGS_SCHEMA 顺序时请同步维护测试断言或重排 runtime/smtp 位置。
 */

export type FieldType = "text" | "number" | "password" | "switch" | "textarea";

export type FieldDef = {
	/** 设置 key（同 settings record key） */
	key: string;
	label: string;
	type: FieldType;
	placeholder?: string;
	defaultValue?: string;
	autoComplete?: string;
	/** 静态 helperText 或动态 helperText（基于当前 settings 实时生成） */
	helperText?: string | ((settings: Record<string, string>) => string | undefined);
	/** 数字范围（用于 number 类型），同时也是默认 validate 的一部分 */
	min?: number;
	max?: number;
	/** 当 fallback validate 不够用时的自定义校验，返回 null = ok，字符串 = 错误信息 */
	validate?: (value: string, settings: Record<string, string>) => string | null;
	/** 字段被禁用的条件（典型场景：SMTP 字段在未启用时禁用） */
	disabled?: (settings: Record<string, string>) => boolean;
	/** 关联到 runtime-settings DTO 的 key，默认等于 key 本身（仅 runtime 分组使用） */
	runtimeSummaryKey?: string;
};

export type BadgeTone = "cyan" | "emerald" | "amber" | "slate";

export type SectionLayout = "stack" | "grid-2";

export type SectionDef = {
	id: string;
	icon: string;
	title: string;
	description: string | ((settings: Record<string, string>) => string);
	/** 静态徽标或基于 settings 的动态徽标（如 SMTP 已启用/未启用） */
	badge?: string | ((settings: Record<string, string>) => string);
	badgeTone?: BadgeTone | ((settings: Record<string, string>) => BadgeTone);
	defaultOpen: boolean;
	asForm?: boolean;
	layout?: SectionLayout;
	/** Section 内顶部的提示横幅（如 runtime 的"需重启"说明） */
	noticeBanner?: string;
	/** 保存成功后展示的 toast 文案 */
	saveMessage: string;
	/** Section 的字段 */
	fields: FieldDef[];
	/** 把哪个字段（如 smtp.enabled）作为 header 右侧的开关？（仅 SMTP 用） */
	headerSwitchKey?: string;
	/** 该 section 是否走"特殊 children"路径（如 2FA 是单独组件，不靠 fields 渲染） */
	custom?: "two-factor";
};

/* ── 校验工具 ───────────────────────────────────────────── */

export function parseInteger(value: string, label: string, min: number, max: number): string | null {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return `${label} 必须是数字`;
	const integer = Math.trunc(parsed);
	if (integer < min || integer > max) return `${label} 必须在 ${min} 到 ${max} 之间`;
	return null;
}

const isValidEmail = (s: string) => /^.+@.+\..+$/.test(s);

const validateLogoUrl = (value: string): string | null => {
	const trimmed = value.trim();
	if (!trimmed || trimmed.startsWith("/")) return null;
	try {
		const parsed = new URL(trimmed);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? null : "Logo URL 只支持 http(s) 或站内路径";
	} catch {
		return "Logo URL 只支持 http(s) 或站内路径";
	}
};

/* ── 工厂 ───────────────────────────────────────────────── */

function runtimeNumber(key: string, label: string, defaultValue: string, min: number, max: number): FieldDef {
	// label 去掉括号里的"需重启"等修饰生成校验用的 short label
	const validateLabel = label.replace(/（[^）]*）/g, "").trim();
	return {
		key,
		label,
		type: "number",
		placeholder: defaultValue,
		defaultValue,
		min,
		max,
		validate: (value) => parseInteger(value, validateLabel, min, max),
	};
}

/* ── Schema ─────────────────────────────────────────────── */

const SMTP_DISABLED_HINT = "启用 SMTP 后可编辑";
const isSmtpDisabled = (s: Record<string, string>) => s["smtp.enabled"] !== "true";

export const SETTINGS_SCHEMA: SectionDef[] = [
	{
		id: "2fa",
		icon: "🛡️",
		title: "账户安全",
		description: "当前登录账号的二次验证集中在系统设置中管理，避免分散在侧栏底部入口。",
		badge: "2FA",
		defaultOpen: true,
		saveMessage: "",
		fields: [],
		custom: "two-factor",
	},
	{
		id: "platform",
		icon: "🌐",
		title: "平台信息",
		description: "保存后新打开或刷新后的页面会读取最新品牌信息；Logo 支持 http(s) 地址或站内 `/...` 路径。",
		defaultOpen: true,
		saveMessage: "平台信息已保存；新打开/刷新后的页面会读取最新名称和 Logo。",
		fields: [
			{
				key: "platform.name",
				label: "平台名称",
				type: "text",
				placeholder: "VPS 统一管控平台",
				helperText: "不能为空，最多 80 个字符；用于页面标题和公开品牌文案。",
				validate: (value) => (value.trim() ? null : "平台名称不能为空"),
			},
			{
				key: "platform.logo",
				label: "Logo URL",
				type: "text",
				placeholder: "https://example.com/logo.png",
				helperText: "留空则不显示 Logo；支持 http(s) 或 /icon.png 这类站内路径。",
				validate: validateLogoUrl,
			},
		],
	},
	{
		id: "password",
		icon: "🔐",
		title: "会话与安全",
		description: "会话超时只影响保存后的新登录；密码策略会立即用于创建用户、重置密码和账号改密。",
		defaultOpen: true,
		saveMessage: "会话与密码策略已保存；会话超时只影响新登录，密码策略立即用于创建用户、重置密码和改密。",
		fields: [
			{
				key: "session.timeout",
				label: "会话超时（秒）",
				type: "number",
				placeholder: "86400",
				min: 300,
				max: 2_592_000,
				helperText: "300–2592000 秒；已有 session 不会被 retroactively 缩短。",
				validate: (value) => parseInteger(value, "会话超时", 300, 2_592_000),
			},
			{
				key: "password.minLength",
				label: "密码最小长度",
				type: "number",
				placeholder: "8",
				min: 8,
				max: 128,
				helperText: "8–128 位；保存后立即约束新密码。",
				validate: (value) => parseInteger(value, "密码最小长度", 8, 128),
			},
			{ key: "password.requireUppercase", label: "要求大写字母", type: "switch" },
			{ key: "password.requireNumber", label: "要求数字", type: "switch" },
			{ key: "password.requireSpecial", label: "要求特殊字符", type: "switch" },
		],
	},
	{
		id: "runtime",
		icon: "⚙️",
		title: "运行参数",
		description:
			"非敏感稳定性/可用性参数。命令执行、SFTP 同步、任务中心和 AI 列表上限相关项会立即生效；命令维护扫描和 SSH 终端连接保活参数需要重启对应服务后生效。SSH 终端默认强保活：只要浏览器页面还开着、网络和目标 SSH 仍可用，系统不会因为空闲主动断开。",
		badge: "高级",
		defaultOpen: false,
		layout: "grid-2",
		noticeBanner: "当前运行值来自数据库设置、环境变量或系统默认值；带“需重启”的项目保存后不会改变已启动的 SSH/维护扫描进程，需重启对应服务。",
		saveMessage: "运行参数已保存；标注“需重启”的 SSH/维护扫描参数请重启对应服务，其余新请求/新任务立即读取。",
		fields: [
			runtimeNumber("runtime.commandExecutionTimeoutMs", "命令执行超时（毫秒）", "300000", 5_000, 3_600_000),
			runtimeNumber("runtime.commandOutputLimitBytes", "命令输出保留上限（字节）", "262144", 4_096, 10_485_760),
			runtimeNumber("runtime.commandStaleRunningAfterMs", "命令卡死判定时间（毫秒）", "600000", 30_000, 86_400_000),
			runtimeNumber("runtime.commandExecutionHeartbeatMs", "命令执行心跳间隔（毫秒）", "60000", 5_000, 600_000),
			runtimeNumber("runtime.commandReconcileIntervalMs", "命令维护扫描间隔（毫秒，需重启）", "60000", 5_000, 3_600_000),
			runtimeNumber("runtime.sftpSyncDirectoryTimeoutMs", "SFTP 单目录同步超时（毫秒）", "60000", 5_000, 1_800_000),
			runtimeNumber("runtime.sshWsHeartbeatIntervalMs", "SSH WebSocket 心跳间隔（毫秒，需重启）", "25000", 5_000, 600_000),
			runtimeNumber("runtime.sshKeepaliveIntervalMs", "SSH keepalive 间隔（毫秒，需重启）", "30000", 5_000, 600_000),
			runtimeNumber("runtime.sshKeepaliveCountMax", "SSH keepalive 容忍次数（需重启，默认强保活）", "60", 1, 60),
			runtimeNumber("runtime.operationTaskListLimit", "任务中心列表上限（条）", "100", 20, 500),
			runtimeNumber("runtime.aiProviderListLimit", "AI 提供商列表上限（条）", "100", 10, 500),
			runtimeNumber("runtime.aiConversationListLimit", "AI 对话列表上限（条）", "200", 20, 1_000),
		],
	},
	{
		id: "smtp",
		icon: "📧",
		title: "邮件通知（SMTP）",
		description: (s) => (s["smtp.enabled"] === "true"
			? "SMTP 已启用，告警规则选择 email 渠道时会发送到下方收件人。"
			: "SMTP 未启用，连接参数会保留但不会被用于发送邮件。启用后可在告警规则中选择 email 渠道。"),
		badge: (s) => (s["smtp.enabled"] === "true" ? "已启用" : "未启用"),
		badgeTone: (s) => (s["smtp.enabled"] === "true" ? "emerald" : "slate"),
		defaultOpen: false,
		asForm: true,
		layout: "grid-2",
		saveMessage: "SMTP 设置已保存；启用后系统通知会使用最新连接参数。",
		headerSwitchKey: "smtp.enabled",
		fields: [
			// smtp.enabled 由 headerSwitchKey 渲染到 header；同时也参与保存的 key 列表，
			// 所以它仍然要出现在 fields 里（type=switch + 标记为 hidden via headerSwitchKey）。
			{ key: "smtp.enabled", label: "启用 SMTP", type: "switch" },
			{
				key: "smtp.host",
				label: "SMTP 服务器",
				type: "text",
				placeholder: "smtp.example.com",
				disabled: isSmtpDisabled,
				helperText: (s) => (isSmtpDisabled(s) ? SMTP_DISABLED_HINT : undefined),
			},
			{
				key: "smtp.port",
				label: "端口",
				type: "number",
				placeholder: "587",
				min: 1,
				max: 65_535,
				disabled: isSmtpDisabled,
				helperText: (s) => (isSmtpDisabled(s) ? SMTP_DISABLED_HINT : "1–65535；常用 465/587。"),
				validate: (value) => parseInteger(value || "587", "SMTP 端口", 1, 65_535),
			},
			{
				key: "smtp.user",
				label: "用户名",
				type: "text",
				placeholder: "user@example.com",
				autoComplete: "username",
				disabled: isSmtpDisabled,
				helperText: (s) => (isSmtpDisabled(s) ? SMTP_DISABLED_HINT : undefined),
			},
			{
				key: "smtp.pass",
				label: "密码",
				type: "password",
				placeholder: "••••••••",
				autoComplete: "new-password",
				disabled: isSmtpDisabled,
				helperText: (s) => (isSmtpDisabled(s) ? SMTP_DISABLED_HINT : undefined),
			},
			{
				key: "smtp.from",
				label: "发件人地址",
				type: "text",
				placeholder: "noreply@example.com",
				disabled: isSmtpDisabled,
				helperText: (s) => (isSmtpDisabled(s) ? SMTP_DISABLED_HINT : "保存前会校验邮箱格式。"),
				validate: (value) => (value.trim() && !isValidEmail(value.trim()) ? "发件人地址格式不正确" : null),
			},
			{
				key: "smtp.alertRecipients",
				label: "告警收件人",
				type: "text",
				placeholder: "ops@example.com, admin@example.com",
				disabled: isSmtpDisabled,
				helperText: (s) => (isSmtpDisabled(s)
					? SMTP_DISABLED_HINT
					: "多个地址可用逗号、分号或换行分隔；告警测试和真实告警共用此列表。"),
				validate: (value) => {
					const recipients = value.split(/[\n,;，；]+/).map((item) => item.trim()).filter(Boolean);
					const invalid = recipients.find((recipient) => !isValidEmail(recipient));
					return invalid ? `告警收件人地址格式不正确：${invalid}` : null;
				},
			},
		],
	},
];

/* ── Helpers ────────────────────────────────────────────── */

/** 一个 section 中需要参与 PATCH 保存的所有字段 key（custom section 不参与） */
export function getSectionSaveKeys(section: SectionDef): string[] {
	if (section.custom) return [];
	return section.fields.map((f) => f.key);
}

/** TOC 用的导航项 */
export function buildTocItems(): { id: string; icon: string; title: string; subtitle: string }[] {
	const subtitleByCount = (n: number) => `${n} 项`;
	const customSubtitle: Record<string, string> = {
		"2fa": "两步验证",
		platform: "品牌 / Logo",
		password: "超时 / 复杂度",
		smtp: "SMTP / 告警收件人",
		runtime: "命令 / SSH / 列表上限",
	};
	return SETTINGS_SCHEMA.map((s) => ({
		id: s.id,
		icon: s.icon,
		title: s.title === "邮件通知（SMTP）" ? "邮件通知" : s.title,
		subtitle: customSubtitle[s.id] ?? subtitleByCount(s.fields.length),
	}));
}
