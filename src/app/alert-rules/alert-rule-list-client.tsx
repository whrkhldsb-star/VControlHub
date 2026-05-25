"use client";

import { useState, useCallback } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";

type AlertRule = {
	id: string; name: string; metric: string; operator: string;
	threshold: number; durationSeconds: number; serverIds: string[];
	notifyChannels: string[]; webhookConfigured: boolean;
	cooldownMinutes: number; enabled: boolean;
	lastTriggeredAt: string | null; createdAt: string;
};

type ServerOption = { id: string; name: string };

type Props = {
	rules: AlertRule[];
	servers: ServerOption[];
	canManage: boolean;
};

const metricLabels: Record<string, string> = {
	cpu_usage: "CPU 使用率",
	mem_usage: "内存使用率",
	disk_usage: "磁盘使用率",
	server_offline: "服务器离线",
};

const operatorLabels: Record<string, string> = {
	gt: "大于", gte: "大于等于", lt: "小于", lte: "小于等于", eq: "等于",
};

export function AlertRuleListClient({ rules: initialRules, servers, canManage }: Props) {
	const { addToast } = useToast();
	const [rules, setRules] = useState(initialRules);
	const [showCreate, setShowCreate] = useState(false);

	const refresh = useCallback(async () => {
		const data = await csrfFetch("/api/alert-rules");
		setRules(data?.rules ?? []);
	}, []);

	const toggleRule = useCallback(async (id: string) => {
		await csrfFetch("/api/alert-rules", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ toggleId: id }),
		});
		refresh();
	}, [refresh]);

	const deleteRule = useCallback(async (id: string) => {
		if (!confirm("确认删除该告警规则？")) return;
		await csrfFetch(`/api/alert-rules?id=${id}`, { method: "DELETE" });
		refresh();
	}, [refresh]);

	const triggerNow = useCallback(async () => {
		await csrfFetch("/api/alert-rules", { method: "PUT" });
		addToast("error", "告警检测已触发");
	}, [addToast]);

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3 flex-wrap">
				{canManage && !showCreate && (
					<button onClick={() => setShowCreate(true)} className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-5 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-400/20 transition">
						+ 创建告警规则
					</button>
				)}
				<button onClick={triggerNow} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-5 py-2.5 text-sm text-slate-300 hover:bg-white/[0.06] transition">
					🔍 立即检测
				</button>
			</div>

			{showCreate && (
				<CreateRuleForm servers={servers} onClose={() => { setShowCreate(false); refresh(); }} />
			)}

			{rules.length === 0 ? (
				<div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
					<div className="text-4xl mb-3">🔔</div>
					<p className="text-sm text-slate-500">暂无告警规则</p>
				</div>
			) : (
				<div className="space-y-3">
					{rules.map((rule) => (
						<article key={rule.id} className={`rounded-xl border bg-white/[0.02] p-5 transition-colors duration-150 ${rule.enabled ? "border-white/[0.06] hover:bg-white/[0.04]" : "border-white/[0.04] opacity-60"}`}>
							<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
								<div>
									<h2 className="text-lg font-semibold text-white">{rule.name}</h2>
									<p className="mt-1 text-xs text-slate-500">
										当 <span className="text-cyan-300/80">{metricLabels[rule.metric] ?? rule.metric}</span>{" "}
										<span className="text-white/70">{operatorLabels[rule.operator] ?? rule.operator}</span>{" "}
										<span className="text-amber-300 font-mono">{rule.threshold}{rule.metric !== "server_offline" ? "%" : ""}</span>
										{rule.durationSeconds > 0 && <span className="text-slate-500"> 持续 {rule.durationSeconds}s</span>}
										{rule.serverIds.length === 0 ? " (全部节点)" : ` (${rule.serverIds.length} 节点)`}
									</p>
									<div className="mt-2 flex flex-wrap gap-1.5">
										{rule.notifyChannels.map((ch) => (
											<span key={ch} className="rounded-md border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-500">
												{ch === "in_app" ? "站内通知" : ch === "email" ? "邮件" : ch === "webhook" ? "Webhook" : ch}
											</span>
										))}
						{rule.webhookConfigured && (
							<span className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-200">
								Webhook 已配置
							</span>
						)}
						{rule.cooldownMinutes > 0 && (
							<span className="rounded-md border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-500">
								冷却 {rule.cooldownMinutes}min
							</span>
						)}
									</div>
									{rule.lastTriggeredAt && (
										<p className="mt-1 text-[11px] text-slate-600">上次触发：{new Date(rule.lastTriggeredAt).toLocaleString("zh-CN")}</p>
									)}
								</div>
								{canManage && (
									<div className="flex flex-col gap-2 shrink-0">
										<button
											onClick={() => toggleRule(rule.id)}
											className={`rounded-2xl border px-4 py-2 text-xs font-medium transition ${
												rule.enabled
													? "border-amber-400/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20"
													: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20"
											}`}
										>
											{rule.enabled ? "暂停" : "启用"}
										</button>
										<button
											onClick={() => deleteRule(rule.id)}
											className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs font-medium text-rose-100 hover:bg-rose-400/20 transition"
										>
											删除
										</button>
									</div>
								)}
							</div>
						</article>
					))}
				</div>
			)}
		</div>
	);
}

/* ── Create form ──────────────────────────────────────────── */

function CreateRuleForm({ onClose }: { servers: ServerOption[]; onClose: () => void }) {
	const [name, setName] = useState("");
	const [metric, setMetric] = useState("cpu_usage");
	const [operator, setOperator] = useState("gte");
	const [threshold, setThreshold] = useState(85);
	const [cooldown, setCooldown] = useState(30);
	const [channels, setChannels] = useState<string[]>(["in_app"]);
	const [webhookUrl, setWebhookUrl] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const toggleChannel = (ch: string) => {
		setChannels((prev) => prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			await csrfFetch("/api/alert-rules", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					metric,
					operator,
					threshold,
					notifyChannels: channels,
					cooldownMinutes: cooldown,
					webhookUrl: channels.includes("webhook") && webhookUrl.trim() ? webhookUrl.trim() : undefined,
				}),
			});
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "创建失败");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
			<h3 className="text-lg font-semibold text-white">创建告警规则</h3>
			{error && <div className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200">{error}</div>}

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="alertRuleName">规则名称</label>
				<input id="alertRuleName" value={name} onChange={(e) => setName(e.target.value)} required placeholder="例如：CPU 过载告警" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30" />
			</div>

			<div className="grid gap-3 sm:grid-cols-3">
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-white/50 tracking-wide">监控指标</label>
					<select value={metric} onChange={(e) => setMetric(e.target.value)} className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none">
						<option value="cpu_usage">CPU 使用率</option>
						<option value="mem_usage">内存使用率</option>
						<option value="disk_usage">磁盘使用率</option>
						<option value="server_offline">服务器离线</option>
					</select>
				</div>
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-white/50 tracking-wide">比较方式</label>
					<select value={operator} onChange={(e) => setOperator(e.target.value)} className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none">
						<option value="gt">大于</option>
						<option value="gte">大于等于</option>
						<option value="lt">小于</option>
						<option value="lte">小于等于</option>
					</select>
				</div>
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="alertThreshold">阈值</label>
					<input id="alertThreshold" type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} min={0} max={100} className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-2.5 text-sm text-white font-mono outline-none focus:border-cyan-400/30" />
				</div>
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white/50 tracking-wide">通知渠道</label>
				<div className="flex flex-wrap gap-2">
					{[{ key: "in_app", label: "站内通知" }, { key: "email", label: "邮件" }, { key: "webhook", label: "Webhook" }].map(({ key, label }) => (
						<button key={key} type="button" onClick={() => toggleChannel(key)}
							className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${channels.includes(key) ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" : "border-white/[0.06] bg-white/[0.03] text-slate-500 hover:bg-white/[0.05]"}`}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			{channels.includes("webhook") && (
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-white/50 tracking-wide">Webhook URL</label>
					<input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://hooks.example.com/..." className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white font-mono outline-none transition placeholder:text-white/20 focus:border-cyan-400/30" />
				</div>
			)}

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white/50 tracking-wide">冷却时间（分钟）</label>
				<input type="number" value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} min={1} className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white font-mono outline-none focus:border-cyan-400/30 w-32" />
			</div>

			<div className="flex gap-3 pt-2">
				<button type="submit" disabled={submitting} className="rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60">
					{submitting ? "创建中…" : "创建规则"}
				</button>
				<button type="button" onClick={onClose} className="rounded-2xl border border-white/10 px-5 py-2 text-sm text-slate-300 hover:bg-white/10 transition">
					取消
				</button>
			</div>
		</form>
	);
}
