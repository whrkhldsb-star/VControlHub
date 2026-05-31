"use client";

import { useState, useCallback, useId } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { TwoFactorSettings } from "@/components/two-factor-settings";

type Props = {
	settings: Record<string, string>;
	canManage: boolean;
	twoFactorEnabled?: boolean;
};

export function SettingsClient({ settings: initialSettings, canManage, twoFactorEnabled = false }: Props) {
	const [settings, setSettings] = useState(initialSettings);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const updateField = (key: string, value: string) => {
		setSettings((prev) => ({ ...prev, [key]: value }));
		setSaved(false);
	};

	const handleSave = useCallback(async (section: string, keys: string[]) => {
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
			setTimeout(() => setSaved(false), 3000);
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
				<div className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-4 py-3 text-sm text-rose-200">{error}</div>
			)}
			{saved && (
				<div className="rounded-lg bg-emerald-500/[0.08] border border-emerald-400/20 px-4 py-3 text-sm text-emerald-200">✓ 设置已保存</div>
			)}

			{/* Account security */}
			<section id="2fa" className="scroll-mt-24 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
				<div>
					<h2 className="text-lg font-semibold text-white flex items-center gap-2">🛡️ 账户安全</h2>
					<p className="mt-1 text-xs text-slate-500">当前登录账号的二次验证集中在系统设置中管理，避免分散在侧栏底部入口。</p>
				</div>
				<TwoFactorSettings enabled={twoFactorEnabled} />
			</section>

			{/* Platform */}
			<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
				<h2 className="text-lg font-semibold text-white flex items-center gap-2">🌐 平台信息</h2>
				<Field label="平台名称" value={settings["platform.name"] ?? ""} onChange={(v) => updateField("platform.name", v)} placeholder="VPS 统一管控平台" />
				<Field label="Logo URL" value={settings["platform.logo"] ?? ""} onChange={(v) => updateField("platform.logo", v)} placeholder="https://example.com/logo.png" />
				<SaveButton onClick={() => handleSave("platform", ["platform.name", "platform.logo"])} saving={saving} />
			</section>

			{/* Session */}
			<section id="password" className="scroll-mt-24 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
				<h2 className="text-lg font-semibold text-white flex items-center gap-2">🔐 会话与安全</h2>
				<Field label="会话超时（秒）" value={settings["session.timeout"] ?? ""} onChange={(v) => updateField("session.timeout", v)} placeholder="86400" type="number" />
				<Field label="密码最小长度" value={settings["password.minLength"] ?? ""} onChange={(v) => updateField("password.minLength", v)} placeholder="8" type="number" />
				<SwitchField label="要求大写字母" value={settings["password.requireUppercase"] === "true"} onChange={(v) => updateField("password.requireUppercase", v ? "true" : "false")} />
				<SwitchField label="要求数字" value={settings["password.requireNumber"] === "true"} onChange={(v) => updateField("password.requireNumber", v ? "true" : "false")} />
				<SwitchField label="要求特殊字符" value={settings["password.requireSpecial"] === "true"} onChange={(v) => updateField("password.requireSpecial", v ? "true" : "false")} />
				<SaveButton onClick={() => handleSave("session", ["session.timeout", "password.minLength", "password.requireUppercase", "password.requireNumber", "password.requireSpecial"])} saving={saving} />
			</section>

			{/* Runtime tuning */}
			<section id="runtime" className="scroll-mt-24 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
				<div>
					<h2 className="text-lg font-semibold text-white flex items-center gap-2">⚙️ 运行参数</h2>
					<p className="mt-1 text-xs text-slate-500">这些是非敏感稳定性/可用性参数。命令执行、SFTP 同步、任务中心和 AI 列表上限相关项会立即生效；命令维护扫描和 SSH 终端连接保活参数需要重启对应服务后生效。</p>
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
					<Field label="SSH keepalive 容忍次数（需重启）" value={settings["runtime.sshKeepaliveCountMax"] ?? "8"} onChange={(v) => updateField("runtime.sshKeepaliveCountMax", v)} placeholder="8" type="number" />
					<Field label="任务中心列表上限（条）" value={settings["runtime.operationTaskListLimit"] ?? "100"} onChange={(v) => updateField("runtime.operationTaskListLimit", v)} placeholder="100" type="number" />
					<Field label="AI 提供商列表上限（条）" value={settings["runtime.aiProviderListLimit"] ?? "100"} onChange={(v) => updateField("runtime.aiProviderListLimit", v)} placeholder="100" type="number" />
					<Field label="AI 对话列表上限（条）" value={settings["runtime.aiConversationListLimit"] ?? "200"} onChange={(v) => updateField("runtime.aiConversationListLimit", v)} placeholder="200" type="number" />
				</div>
				<SaveButton onClick={() => handleSave("runtime", ["runtime.commandExecutionTimeoutMs", "runtime.commandOutputLimitBytes", "runtime.commandStaleRunningAfterMs", "runtime.commandExecutionHeartbeatMs", "runtime.commandReconcileIntervalMs", "runtime.sftpSyncDirectoryTimeoutMs", "runtime.sshWsHeartbeatIntervalMs", "runtime.sshKeepaliveIntervalMs", "runtime.sshKeepaliveCountMax", "runtime.operationTaskListLimit", "runtime.aiProviderListLimit", "runtime.aiConversationListLimit"])} saving={saving} />
			</section>

			{/* SMTP */}
			<form className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4" onSubmit={(event) => event.preventDefault()}>
				<h2 className="text-lg font-semibold text-white flex items-center gap-2">📧 邮件通知（SMTP）</h2>
				<SwitchField label="启用 SMTP" value={settings["smtp.enabled"] === "true"} onChange={(v) => updateField("smtp.enabled", v ? "true" : "false")} />
				<Field label="SMTP 服务器" value={settings["smtp.host"] ?? ""} onChange={(v) => updateField("smtp.host", v)} placeholder="smtp.example.com" />
				<Field label="端口" value={settings["smtp.port"] ?? ""} onChange={(v) => updateField("smtp.port", v)} placeholder="587" type="number" />
				<Field label="用户名" value={settings["smtp.user"] ?? ""} onChange={(v) => updateField("smtp.user", v)} placeholder="user@example.com" autoComplete="username" />
				<Field label="密码" value={settings["smtp.pass"] ?? ""} onChange={(v) => updateField("smtp.pass", v)} placeholder="••••••••" type="password" autoComplete="new-password" />
				<Field label="发件人地址" value={settings["smtp.from"] ?? ""} onChange={(v) => updateField("smtp.from", v)} placeholder="noreply@example.com" />
				<SaveButton onClick={() => handleSave("smtp", ["smtp.enabled", "smtp.host", "smtp.port", "smtp.user", "smtp.pass", "smtp.from"])} saving={saving} />
			</form>
		</div>
	);
}

/* ── Sub-components ───────────────────────────────────────── */

function Field({ label, value, onChange, placeholder, type = "text", autoComplete }: {
	label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoComplete?: string;
}) {
	const inputId = useId();
	return (
		<div className="space-y-1.5 rounded-lg border border-transparent bg-white/[0.01] p-3 light:border-slate-200 light:bg-white">
			<label htmlFor={inputId} className="block text-xs font-semibold text-white/50 tracking-wide light:text-slate-700">{label}</label>
			<input
				id={inputId}
				type={type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				autoComplete={autoComplete}
				className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 light:border-slate-300 light:bg-slate-50 light:text-slate-950 light:placeholder:text-slate-400"
			/>
		</div>
	);
}

function SwitchField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
	return (
		<div className="flex items-center justify-between">
			<span className="text-sm text-slate-300">{label}</span>
			<button
				type="button"
				onClick={() => onChange(!value)}
				className={`relative w-10 h-5 rounded-full transition-colors ${value ? "bg-cyan-500" : "bg-slate-700"}`}
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
