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

export type FieldType = "text" | "number" | "password" | "select" | "switch" | "textarea";

export type SelectOption = {
	/** 实际写入 settings 记录的值（字符串） */
	value: string;
	/** 渲染给用户看的标签 */
	label: string;
};

export type FieldRiskLevel = "low" | "medium" | "high";

export type FieldDef = {
	/** 设置 key（同 settings record key） */
	key: string;
	label: string;
	type: FieldType;
	placeholder?: string;
	defaultValue?: string;
	autoComplete?: string;
	/** select 类型的下拉选项（type=select 必填） */
	options?: SelectOption[];
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
	// ── TR-014 设置页高风险设置 (M01) ──────────────────────
	/**
	 * 风险等级：
	 *   low    — 改了不影响现有用户/服务（默认）
	 *   medium — 改了行为但不会立即破坏（多数 runtime.* 调参）
	 *   high   — 改了可能立即破坏已运行服务（密码/超时/SMTP 密码等）
	 * UI 据此渲染警告图标 + (M01b) 失焦时弹确认 modal。
	 */
	riskLevel?: FieldRiskLevel;
	/**
	 * 是否支持"恢复默认"按钮（点击把字段值重置为 `defaultValue`）。
	 * 推断规则：有 `defaultValue` 的字段默认支持；显式设为 false 可关闭。
	 * (M01a: 仅 text/number/select/textarea 渲染按钮; password 默认不渲染, 避免误清空)
	 */
	rollbackable?: boolean;
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
				// TR-014: 改 session 超时会影响所有新登录; 设错短值会立即影响生产
				riskLevel: "high",
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
				// TR-014: 改了立即约束新建/重置/改密流程; 调短可能让旧弱密码不通过
				riskLevel: "high",
			},
			{ key: "password.requireUppercase", label: "要求大写字母", type: "switch", riskLevel: "medium" },
			{ key: "password.requireNumber", label: "要求数字", type: "switch", riskLevel: "medium" },
			{ key: "password.requireSpecial", label: "要求特殊字符", type: "switch", riskLevel: "medium" },
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
			// TR-014: 命令执行超时调短会让中等长度任务被误杀; 卡死判定调短会让正常耗时任务被标 stale
			Object.assign(runtimeNumber("runtime.commandExecutionTimeoutMs", "命令执行超时（毫秒）", "300000", 5_000, 3_600_000), { riskLevel: "high" as const }),
			Object.assign(runtimeNumber("runtime.commandOutputLimitBytes", "命令输出保留上限（字节）", "262144", 4_096, 10_485_760), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.commandStaleRunningAfterMs", "命令卡死判定时间（毫秒）", "600000", 30_000, 86_400_000), { riskLevel: "high" as const }),
			Object.assign(runtimeNumber("runtime.commandExecutionHeartbeatMs", "命令执行心跳间隔（毫秒）", "60000", 5_000, 600_000), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.commandReconcileIntervalMs", "命令维护扫描间隔（毫秒，需重启）", "60000", 5_000, 3_600_000), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.sftpSyncDirectoryTimeoutMs", "SFTP 单目录同步超时（毫秒）", "60000", 5_000, 1_800_000), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.sshWsHeartbeatIntervalMs", "SSH WebSocket 心跳间隔（毫秒，需重启）", "25000", 5_000, 600_000), { riskLevel: "medium" as const }),
			{
				key: "runtime.sshIdleTimeoutSec",
				label: "SSH 空闲超时",
				type: "select",
				defaultValue: "0",
				helperText: "浏览器侧 SSH 终端多久无操作后自动断开连接。默认为「永不」（强保活：只要页面开着、网络和目标 SSH 仍可用就不会断）；调短可以减少无效长连接占用。保存后需重启 SSH WebSocket 服务。",
				options: [
					{ value: "0", label: "永不（强保活）" },
					{ value: "300", label: "5 分钟" },
					{ value: "600", label: "10 分钟" },
					{ value: "1800", label: "30 分钟" },
					{ value: "3600", label: "1 小时" },
					{ value: "7200", label: "2 小时" },
				],
				validate: (value) => {
					if (value === "0") return null;
					const parsed = Number(value);
					if (!Number.isFinite(parsed)) return "SSH 空闲超时 必须是数字秒数";
					const seconds = Math.trunc(parsed);
					if (seconds < 60 || seconds > 7200) return "SSH 空闲超时 必须在 60 到 7200 秒之间 (0 表示永不)";
					return null;
				},
				// TR-014: 改此值需重启 ssh-ws, 且误短会让用户 SSH 终端频繁掉线
				riskLevel: "high",
			},
			Object.assign(runtimeNumber("runtime.operationTaskListLimit", "任务中心列表上限（条）", "100", 20, 500), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.aiProviderListLimit", "AI 提供商列表上限（条）", "100", 10, 500), { riskLevel: "medium" as const }),
			Object.assign(runtimeNumber("runtime.aiConversationListLimit", "AI 对话列表上限（条）", "200", 20, 1_000), { riskLevel: "medium" as const }),
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
				// TR-014: SMTP 密码错会让所有邮件告警失败; 改后无法立即验证
				riskLevel: "high",
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
	{
		// TR-020 M02: 仪表盘布局相关总开关 (admin 可关)
		// 放在 SETTINGS_SCHEMA 末尾, 不会改变既有 platform/password/runtime/smtp 的保存按钮顺序断言
		id: "dashboard",
		icon: "🧩",
		title: "仪表盘布局",
		description: "控制仪表盘首页的拖拽重排与编辑入口；不影响 widget 内容本身。",
		defaultOpen: false,
		saveMessage: "仪表盘布局设置已保存；拖拽开关关闭后首页不再显示「编辑布局」入口。",
		fields: [
			{
				key: "dashboard.layout.dragReorderEnabled",
				label: "允许拖拽重排仪表盘 widget",
				type: "switch",
				defaultValue: "true",
				helperText: "关闭后仪表盘顶部不再显示「编辑布局」入口，widget 顺序与显隐使用当前持久化结果不再变化。",
			},
		],
	},
	{
		// TR-007 M03: 异地备份 (S3-compatible)
		// 放在 SETTINGS_SCHEMA 末尾, 不影响既有 platform/password/runtime/smtp/dashboard 的索引断言
		id: "offsite",
		icon: "☁️",
		title: "异地备份 (S3-compatible)",
		description: (s) => (s["offsite.enabled"] === "true"
			? "已启用异地备份，每日将本地备份推送至 S3-compatible 端点。"
			: "未启用。启用前下方连接参数会被保存但不会用于实际备份。"),
		badge: (s) => (s["offsite.enabled"] === "true" ? "已启用" : "未启用"),
		badgeTone: (s) => (s["offsite.enabled"] === "true" ? "emerald" : "slate"),
		defaultOpen: false,
		asForm: true,
		layout: "grid-2",
		headerSwitchKey: "offsite.enabled",
		noticeBanner: "异地备份走 SigV4 签名 + PUT/HEAD/DELETE 协议；不引新依赖，复用 undici fetch 与 Node 22 内置 crypto。Provider 决定默认 URL 模式 (AWS → virtual-hosted；其他 → path-style)。",
		saveMessage: "异地备份设置已保存；启用后每日窗口到达时会按当前配置尝试推送，失败会告警到 failureAlertRecipient。",
		fields: [
			// headerSwitchKey 渲染 offsite.enabled 到 header; fields 里同步保留以便 PATCH key 列表正确
			{ key: "offsite.enabled", label: "启用异地备份", type: "switch" },
			{
				key: "offsite.provider",
				label: "Provider",
				type: "select",
				defaultValue: "s3",
				options: [
					{ value: "s3", label: "AWS S3" },
					{ value: "r2", label: "Cloudflare R2" },
					{ value: "b2", label: "Backblaze B2" },
					{ value: "minio", label: "MinIO (自建)" },
				],
				helperText: "Provider 决定默认 URL 寻址模式；S3 走 virtual-hosted，其他默认 path-style。",
			},
			{
				key: "offsite.endpoint",
				label: "Endpoint URL",
				type: "text",
				placeholder: "https://s3.us-east-1.amazonaws.com",
				helperText: "S3-compatible 端点；留空时按 provider + region 推断。",
			},
			{
				key: "offsite.region",
				label: "Region",
				type: "text",
				placeholder: "us-east-1",
				helperText: "AWS region 必填；MinIO/R2/B2 可填任意值但需与 endpoint 保持一致。",
			},
			{
				key: "offsite.bucket",
				label: "Bucket",
				type: "text",
				placeholder: "my-backup-bucket",
				helperText: "目标存储桶；需先在对应 provider 控制台创建。",
			},
			{
				key: "offsite.accessKeyId",
				label: "Access Key ID",
				type: "text",
				placeholder: "AKIAEXAMPLE...",
				helperText: "从 provider 后台获取的 access key；不要使用主账号 root key。",
				// TR-014: 改凭据后下次推送会失败; UI 看不到实际值是否正确, 需配合 dry-run 验证
				riskLevel: "high",
			},
			{
				key: "offsite.secretAccessKey",
				label: "Secret Access Key",
				type: "password",
				placeholder: "••••••••",
				autoComplete: "new-password",
				helperText: "凭据 at-rest 加密 (settings.crypto.service); GET 时返回 *** 占位。",
				// TR-014: 改凭据错会让所有异地推送失败; 改后无法立即验证
				riskLevel: "high",
			},
			{
				key: "offsite.pathPrefix",
				label: "路径前缀",
				type: "text",
				placeholder: "vcontrolhub-backups/",
				helperText: "对象 key 前缀；必须以 / 结尾。",
				validate: (value) => {
					const trimmed = value.trim();
					if (!trimmed) return null;
					return trimmed.endsWith("/") ? null : "路径前缀必须以 / 结尾";
				},
			},
			{
				key: "offsite.dailyWindowHour",
				label: "每日推送窗口 (小时)",
				type: "number",
				placeholder: "3",
				min: 0,
				max: 23,
				helperText: "0–23 整数；UTC 整点窗口；默认 03:00。",
				validate: (value) => parseInteger(value || "3", "每日推送窗口", 0, 23),
			},
			{
				key: "offsite.retentionDays",
				label: "保留天数",
				type: "number",
				placeholder: "30",
				min: 1,
				max: 3650,
				helperText: "异地端保留天数；超过的备份对象会被 lifecycle job 清理。",
				validate: (value) => parseInteger(value || "30", "保留天数", 1, 3650),
			},
			{
				key: "offsite.failureAlertRecipient",
				label: "失败告警收件人",
				type: "text",
				placeholder: "ops@example.com",
				helperText: "异地推送失败时发告警邮件到此地址；留空则不告警。",
				validate: (value) => {
					const trimmed = value.trim();
					if (!trimmed) return null;
					return isValidEmail(trimmed) ? null : "失败告警收件人不是合法邮箱";
				},
			},
		],
	},
	{
		// TR-032 E02: 智能 AI 运维 mode / provider
		// 放在 SETTINGS_SCHEMA 末尾, 不影响既有 platform/password/runtime/smtp/dashboard/offsite 的索引断言
		id: "aiOps",
		icon: "🤖",
		title: "AI 智能运维",
		description: (s) => (s["ai.ops.mode"] === "autonomous"
			? "AI 自主模式：白名单内的安全动作（告警评估、低风险 Playbook 等）会自动执行。"
			: "AI 建议模式：所有动作都需要管理员审批（推荐模式）。autonomous 模式需要 ai:ops:autonomous 权限。"),
		badge: (s) => (s["ai.ops.mode"] === "autonomous" ? "自主模式" : "建议模式"),
		badgeTone: (s) => (s["ai.ops.mode"] === "autonomous" ? "amber" : "cyan"),
		defaultOpen: false,
		saveMessage: "AI 运维设置已保存；新的 mode 在下次扫描生效。",
		fields: [
			{
				key: "ai.ops.mode",
				label: "运行模式",
				type: "select",
				defaultValue: "recommendation",
				options: [
					{ value: "recommendation", label: "建议模式（需人工审批）" },
					{ value: "autonomous", label: "自主模式（白名单内自动执行）" },
				],
				helperText: "切换到 autonomous 前请确认已开启 ai:ops:autonomous 权限，并理解 AI 会按 AI_OPS_SAFE_AUTONOMOUS_ACTIONS 白名单自动执行。",
				riskLevel: "high",
			},
			{
				key: "ai.ops.provider",
				label: "AI 提供方 ID",
				type: "text",
				defaultValue: "",
				placeholder: "留空 = 内置系统健康信号 surface",
				helperText: "可选。对接真实 AI provider 的预留字段（v2），目前仅用于标识与审计；仅允许字母、数字、点、下划线、冒号、连字符，最长 64 个字符。",
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
		dashboard: "拖拽重排 / 编辑入口",
		offsite: "S3 / 推送窗口 / 保留",
		aiOps: "运行模式 / provider",
	};
	return SETTINGS_SCHEMA.map((s) => ({
		id: s.id,
		icon: s.icon,
		title: s.title === "邮件通知（SMTP）" ? "邮件通知" : s.title,
		subtitle: customSubtitle[s.id] ?? subtitleByCount(s.fields.length),
	}));
}
