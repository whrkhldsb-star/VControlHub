"use client";

import { useState, useCallback, useId } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { TwoFactorSettings } from "@/components/two-factor-settings";

type Props = {
	settings: Record<string, string>;
	canManage: boolean;
	twoFactorEnabled?: boolean;
};

const SECTION_SAVE_MESSAGES: Record<string, string> = {
	platform: "平台信息已保存；新打开/刷新后的页面会读取最新名称和 Logo。",
	session: "会话与密码策略已保存；会话超时只影响新登录，密码策略立即用于创建用户、重置密码和改密。",
	runtime: "运行参数已保存；标注“需重启”的 SSH/维护扫描参数请重启对应服务，其余新请求/新任务立即读取。",
	smtp: "SMTP 设置已保存；启用后系统通知会使用最新连接参数。",
};

const RUNTIME_NUMBER_RULES: Record<string, { label: string; min: number; max: number }> = {
	"runtime.commandExecutionTimeoutMs": { label: "命令执行超时", min: 5_000, max: 3_600_000 },
	"runtime.commandOutputLimitBytes": { label: "命令输出保留上限", min: 4_096, max: 10_485_760 },
	"runtime.commandStaleRunningAfterMs": { label: "命令卡死判定时间", min: 30_000, max: 86_400_000 },
	"runtime.commandExecutionHeartbeatMs": { label: "命令执行心跳间隔", min: 5_000, max: 600_000 },
	"runtime.commandReconcileIntervalMs": { label: "命令维护扫描间隔", min: 5_000, max: 3_600_000 },
	"runtime.sftpSyncDirectoryTimeoutMs": { label: "SFTP 单目录同步超时", min: 5_000, max: 1_800_000 },
	"runtime.sshWsHeartbeatIntervalMs": { label: "SSH WebSocket 心跳间隔", min: 5_000, max: 600_000 },
	"runtime.sshKeepaliveIntervalMs": { label: "SSH keepalive 间隔", min: 5_000, max: 600_000 },
	"runtime.sshKeepaliveCountMax": { label: "SSH keepalive 容忍次数", min: 1, max: 60 },
	"runtime.operationTaskListLimit": { label: "任务中心列表上限", min: 20, max: 500 },
	"runtime.aiProviderListLimit": { label: "AI 提供商列表上限", min: 10, max: 500 },
	"runtime.aiConversationListLimit": { label: "AI 对话列表上限", min: 20, max: 1_000 },
};

function parseInteger(value: string, label: string, min: number, max: number) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return `${label} 必须是数字`;
	const integer = Math.trunc(parsed);
	if (integer < min || integer > max) return `${label} 必须在 ${min} 到 ${max} 之间`;
	return null;
}

function validateSettingValue(key: string, value: string) {
	const runtimeRule = RUNTIME_NUMBER_RULES[key];
	if (runtimeRule) {
		return parseInteger(value, runtimeRule.label, runtimeRule.min, runtimeRule.max);
	}
	switch (key) {
		case "platform.name":
			return value.trim() ? null : "平台名称不能为空";
		case "platform.logo": {
			const trimmed = value.trim();
			if (!trimmed || trimmed.startsWith("/")) return null;
			try {
				const parsed = new URL(trimmed);
				return parsed.protocol === "http:" || parsed.protocol === "https:" ? null : "Logo URL 只支持 http(s) 或站内路径";
			} catch {
				return "Logo URL 只支持 http(s) 或站内路径";
			}
		}
		case "session.timeout":
			return parseInteger(value, "会话超时", 300, 2_592_000);
		case "password.minLength":
			return parseInteger(value, "密码最小长度", 8, 128);
		case "smtp.port":
			return parseInteger(value || "587", "SMTP 端口", 1, 65_535);
		case "smtp.from":
			return value.trim() && !/^.+@.+\..+$/.test(value.trim()) ? "发件人地址格式不正确" : null;
		default:
			return null;
	}
}

export function SettingsClient({ settings: initialSettings, canManage, twoFactorEnabled = false }: Props) {
	const [settings, setSettings] = useState(initialSettings);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [savedMessage, setSavedMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const updateField = (key: string, value: string) => {
		setSettings((prev) => ({ ...prev, [key]: value }));
		setSaved(false);
		setSavedMessage(null);
	};

	const handleSave = useCallback(async (section: string, keys: string[]) => {
		const validationErrors = keys
			.map((key) => validateSettingValue(key, settings[key] ?? ""))
			.filter((message): message is string => Boolean(message));
		if (validationErrors.length > 0) {
			setError(validationErrors.join("；"));
			setSaved(false);
			setSavedMessage(null);
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const payload: Record<string, string> = {};
			for (const k of keys) {
				payload[k] = settings[k] ?? "";
			}
			await csrfFetch("/api/settings", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			setSaved(true);
			setSavedMessage(SECTION_SAVE_MESSAGES[section] ?? "设置已保存。");
			setTimeout(() => {
				setSaved(false);
				setSavedMessage(null);
			}, 5000);
		} catch (err) {
			setError(err instanceof Error ? err.message : "保存失败");
		} finally {
			setSaving(false);
		}
	}, [settings]);

	if (!canManage) {
		return (
			<div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
				<div className="text-4xl mb-3">🔒</div>
				<p className="text-sm text-slate-500">当前角色无系统设置权限</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{error && (
				<div className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-4 py-3 text-sm text-rose-200 light:text-rose-800">{error}</div>
			)}
			{saved && (
				<div className="rounded-lg bg-emerald-500/[0.08] border border-emerald-400/20 px-4 py-3 text-sm text-emerald-200 light:text-emerald-800">✓ 设置已保存{savedMessage ? ` — ${savedMessage}` : ""}</div>
			)}

			{/* Account security */}
			<section id="2fa" className="scroll-mt-24 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
				<div>
					<h2 className="text-lg font-semibold text-white light:text-slate-900 flex items-center gap-2">🛡️ 账户安全</h2>
					<p className="mt-1 text-xs text-slate-500">当前登录账号的二次验证集中在系统设置中管理，避免分散在侧栏底部入口。</p>
				</div>
				<TwoFactorSettings enabled={twoFactorEnabled} />
			</section>

			{/* Platform */}
			<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
				<div>
					<h2 className="text-lg font-semibold text-white light:text-slate-900 flex items-center gap-2">🌐 平台信息</h2>
					<p className="mt-1 text-xs text-slate-500">保存后新打开或刷新后的页面会读取最新品牌信息；Logo 支持 http(s) 地址或站内 `/...` 路径。</p>
				</div>
				<Field label="平台名称" value={settings["platform.name"] ?? ""} onChange={(v) => updateField("platform.name", v)} placeholder="VPS 统一管控平台" helperText="不能为空，最多 80 个字符；用于页面标题和公开品牌文案。" />
				<Field label="Logo URL" value={settings["platform.logo"] ?? ""} onChange={(v) => updateField("platform.logo", v)} placeholder="https://example.com/logo.png" helperText="留空则不显示 Logo；支持 http(s) 或 /icon.png 这类站内路径。" />
				<SaveButton onClick={() => handleSave("platform", ["platform.name", "platform.logo"])} saving={saving} />
			</section>

			{/* Session */}
			<section id="password" className="scroll-mt-24 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
				<div>
					<h2 className="text-lg font-semibold text-white light:text-slate-900 flex items-center gap-2">🔐 会话与安全</h2>
					<p className="mt-1 text-xs text-slate-500">会话超时只影响保存后的新登录；密码策略会立即用于创建用户、重置密码和账号改密。</p>
				</div>
				<Field label="会话超时（秒）" value={settings["session.timeout"] ?? ""} onChange={(v) => updateField("session.timeout", v)} placeholder="86400" type="number" helperText="300–2592000 秒；已有 session 不会被 retroactively 缩短。" />
				<Field label="密码最小长度" value={settings["password.minLength"] ?? ""} onChange={(v) => updateField("password.minLength", v)} placeholder="8" type="number" helperText="8–128 位；保存后立即约束新密码。" />
				<SwitchField label="要求大写字母" value={settings["password.requireUppercase"] === "true"} onChange={(v) => updateField("password.requireUppercase", v ? "true" : "false")} />
				<SwitchField label="要求数字" value={settings["password.requireNumber"] === "true"} onChange={(v) => updateField("password.requireNumber", v ? "true" : "false")} />
				<SwitchField label="要求特殊字符" value={settings["password.requireSpecial"] === "true"} onChange={(v) => updateField("password.requireSpecial", v ? "true" : "false")} />
				<SaveButton onClick={() => handleSave("session", ["session.timeout", "password.minLength", "password.requireUppercase", "password.requireNumber", "password.requireSpecial"])} saving={saving} />
			</section>

			{/* Runtime tuning */}
			<section id="runtime" className="scroll-mt-24 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
				<div>
					<h2 className="text-lg font-semibold text-white light:text-slate-900 flex items-center gap-2">⚙️ 运行参数</h2>
					<p className="mt-1 text-xs text-slate-500">这些是非敏感稳定性/可用性参数。命令执行、SFTP 同步、任务中心和 AI 列表上限相关项会立即生效；命令维护扫描和 SSH 终端连接保活参数需要重启对应服务后生效。SSH 终端默认强保活：只要浏览器页面还开着、网络和目标 SSH 仍可用，系统不会因为空闲主动断开。</p>
				</div>
				<div className="grid gap-4 md:grid-cols-2">
					<Field label="命令执行超时（毫秒）" value={settings["runtime.commandExecutionTimeoutMs"] ?? "300000"} onChange={(v) => updateField("runtime.commandExecutionTimeoutMs", v)} placeholder="300000" type="number" />
					<Field label="命令输出保留上限（字节）" value={settings["runtime.commandOutputLimitBytes"] ?? "262144"} onChange={(v) => updateField("runtime.commandOutputLimitBytes", v)} placeholder="262144" type="number" />
					<Field label="命令卡死判定时间（毫秒）" value={settings["runtime.commandStaleRunningAfterMs"] ?? "600000"} onChange={(v) => updateField("runtime.commandStaleRunningAfterMs", v)} placeholder="600000" type="number" />
					<Field label="命令执行心跳间隔（毫秒）" value={settings["runtime.commandExecutionHeartbeatMs"] ?? "60000"} onChange={(v) => updateField("runtime.commandExecutionHeartbeatMs", v)} placeholder="60000" type="number" />
					<Field label="命令维护扫描间隔（毫秒，需重启）" value={settings["runtime.commandReconcileIntervalMs"] ?? "60000"} onChange={(v) => updateField("runtime.commandReconcileIntervalMs", v)} placeholder="60000" type="number" />
					<Field label="SFTP 单目录同步超时（毫秒）" value={settings["runtime.sftpSyncDirectoryTimeoutMs"] ?? "60000"} onChange={(v) => updateField("runtime.sftpSyncDirectoryTimeoutMs", v)} placeholder="60000" type="number" />
					<Field label="SSH WebSocket 心跳间隔（毫秒，需重启）" value={settings["runtime.sshWsHeartbeatIntervalMs"] ?? "25000"} onChange={(v) => updateField("runtime.sshWsHeartbeatIntervalMs", v)} placeholder="25000" type="number" />
					<Field label="SSH keepalive 间隔（毫秒，需重启）" value={settings["runtime.sshKeepaliveIntervalMs"] ?? "30000"} onChange={(v) => updateField("runtime.sshKeepaliveIntervalMs", v)} placeholder="30000" type="number" />
					<Field label="SSH keepalive 容忍次数（需重启，默认强保活）" value={settings["runtime.sshKeepaliveCountMax"] ?? "60"} onChange={(v) => updateField("runtime.sshKeepaliveCountMax", v)} placeholder="60" type="number" />
					<Field label="任务中心列表上限（条）" value={settings["runtime.operationTaskListLimit"] ?? "100"} onChange={(v) => updateField("runtime.operationTaskListLimit", v)} placeholder="100" type="number" />
					<Field label="AI 提供商列表上限（条）" value={settings["runtime.aiProviderListLimit"] ?? "100"} onChange={(v) => updateField("runtime.aiProviderListLimit", v)} placeholder="100" type="number" />
					<Field label="AI 对话列表上限（条）" value={settings["runtime.aiConversationListLimit"] ?? "200"} onChange={(v) => updateField("runtime.aiConversationListLimit", v)} placeholder="200" type="number" />
				</div>
				<SaveButton onClick={() => handleSave("runtime", ["runtime.commandExecutionTimeoutMs", "runtime.commandOutputLimitBytes", "runtime.commandStaleRunningAfterMs", "runtime.commandExecutionHeartbeatMs", "runtime.commandReconcileIntervalMs", "runtime.sftpSyncDirectoryTimeoutMs", "runtime.sshWsHeartbeatIntervalMs", "runtime.sshKeepaliveIntervalMs", "runtime.sshKeepaliveCountMax", "runtime.operationTaskListLimit", "runtime.aiProviderListLimit", "runtime.aiConversationListLimit"])} saving={saving} />
			</section>

			{/* SMTP */}
			<form className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4" onSubmit={(event) => event.preventDefault()}>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<h2 className="text-lg font-semibold text-white light:text-slate-900 flex items-center gap-2">📧 邮件通知（SMTP）</h2>
						<p className="mt-1 text-xs text-slate-500">
							{settings["smtp.enabled"] === "true" ? "SMTP 已启用，保存后系统通知会立即使用最新连接参数。" : "SMTP 未启用，连接参数会保留但不会被用于发送邮件。启用后可先用后续测试发送功能验证。"}
						</p>
					</div>
					<SwitchField label="启用 SMTP" value={settings["smtp.enabled"] === "true"} onChange={(v) => updateField("smtp.enabled", v ? "true" : "false")} />
				</div>
				<div className="grid gap-4 md:grid-cols-2" aria-disabled={settings["smtp.enabled"] !== "true"}>
					<Field label="SMTP 服务器" value={settings["smtp.host"] ?? ""} onChange={(v) => updateField("smtp.host", v)} placeholder="smtp.example.com" disabled={settings["smtp.enabled"] !== "true"} helperText={settings["smtp.enabled"] !== "true" ? "启用 SMTP 后可编辑" : undefined} />
					<Field label="端口" value={settings["smtp.port"] ?? ""} onChange={(v) => updateField("smtp.port", v)} placeholder="587" type="number" disabled={settings["smtp.enabled"] !== "true"} helperText={settings["smtp.enabled"] !== "true" ? "启用 SMTP 后可编辑" : "1–65535；常用 465/587。"} />
					<Field label="用户名" value={settings["smtp.user"] ?? ""} onChange={(v) => updateField("smtp.user", v)} placeholder="user@example.com" autoComplete="username" disabled={settings["smtp.enabled"] !== "true"} helperText={settings["smtp.enabled"] !== "true" ? "启用 SMTP 后可编辑" : undefined} />
					<Field label="密码" value={settings["smtp.pass"] ?? ""} onChange={(v) => updateField("smtp.pass", v)} placeholder="••••••••" type="password" autoComplete="new-password" disabled={settings["smtp.enabled"] !== "true"} helperText={settings["smtp.enabled"] !== "true" ? "启用 SMTP 后可编辑" : undefined} />
					<Field label="发件人地址" value={settings["smtp.from"] ?? ""} onChange={(v) => updateField("smtp.from", v)} placeholder="noreply@example.com" disabled={settings["smtp.enabled"] !== "true"} helperText={settings["smtp.enabled"] !== "true" ? "启用 SMTP 后可编辑" : "保存前会校验邮箱格式。"} />
				</div>
				<SaveButton onClick={() => handleSave("smtp", ["smtp.enabled", "smtp.host", "smtp.port", "smtp.user", "smtp.pass", "smtp.from"])} saving={saving} />
			</form>
		</div>
	);
}

/* ── Sub-components ───────────────────────────────────────── */

function Field({ label, value, onChange, placeholder, type = "text", autoComplete, disabled = false, helperText }: {
	label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoComplete?: string; disabled?: boolean; helperText?: string;
}) {
	const inputId = useId();
	const helperId = useId();
	return (
		<div className={`space-y-1.5 rounded-lg border p-3 transition ${disabled ? "border-white/[0.04] bg-slate-950/20 opacity-70 light:border-slate-200 light:bg-slate-100/80" : "border-transparent bg-white/[0.01] light:border-slate-200 light:bg-white"}`}>
			<label htmlFor={inputId} className="block text-xs font-semibold text-white tracking-wide light:text-slate-700">{label}</label>
			<input
				id={inputId}
				type={type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				autoComplete={autoComplete}
				disabled={disabled}
				aria-describedby={helperText ? helperId : undefined}
				className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 disabled:cursor-not-allowed disabled:border-white/[0.03] disabled:bg-slate-900/50 disabled:text-slate-500 disabled:placeholder:text-white/10 light:border-slate-300 light:bg-slate-50 light:text-slate-950 light:placeholder:text-slate-400 light:disabled:border-slate-200 light:disabled:bg-slate-100 light:disabled:text-slate-500 light:disabled:placeholder:text-slate-300"
			/>
			{helperText && <p id={helperId} className="text-xs text-white light:text-slate-500">{helperText}</p>}
		</div>
	);
}

function SwitchField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-sm text-slate-300 light:text-slate-700">{label}</span>
			<button
				type="button"
				role="switch"
				aria-checked={value}
				aria-label={label}
				onClick={() => onChange(!value)}
				className={`relative w-10 h-5 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${value ? "bg-cyan-500" : "bg-slate-700 light:bg-slate-300"}`}
			>
				<span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? "translate-x-5" : ""}`} />
			</button>
		</div>
	);
}

function SaveButton({ onClick, saving }: { onClick: () => void; saving: boolean }) {
	return (
		<div className="pt-2">
			<button
				onClick={onClick}
				disabled={saving}
				className="rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
			>
				{saving ? "保存中…" : "保存"}
			</button>
		</div>
	);
}
