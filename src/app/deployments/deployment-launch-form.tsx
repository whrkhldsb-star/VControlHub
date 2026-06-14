"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";

type DeploymentTemplateOption = {
	id: string;
	name: string;
	description?: string | null;
	command: string;
	variables?: string[];
};

type DeploymentServerOption = {
	id: string;
	name: string;
	host: string;
	username: string;
};

function uniqueVariables(template?: DeploymentTemplateOption) {
	if (!template) return [];
	const explicit = Array.isArray(template.variables) ? template.variables : [];
	const fromCommand = Array.from(template.command.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)).map((match) => match[1]!);
	return Array.from(new Set([...explicit, ...fromCommand])).filter(Boolean);
}

function previewCommand(template: DeploymentTemplateOption | undefined, variables: string[]) {
	if (!template) return "请选择部署模板";
	return variables.reduce((command, name) => command.replaceAll(`{{${name}}}`, `<${name}>`), template.command);
}

export function DeploymentLaunchForm({ templates, servers }: { templates: DeploymentTemplateOption[]; servers: DeploymentServerOption[] }) {
	const router = useRouter();
	const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];
	const variables = useMemo(() => uniqueVariables(selectedTemplate), [selectedTemplate]);

	if (templates.length === 0) {
		return (
			<div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 light:bg-amber-50">
				请先到“命令模板”创建带变量占位符的部署模板，再回到这里选择目标 VPS 发起部署。
			</div>
		);
	}

	if (servers.length === 0) {
		return (
			<div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 light:bg-amber-50">
				<p className="font-medium">暂无可用 VPS，不能发起部署。</p>
				<p className="mt-1 text-xs text-amber-100/80">请先到服务器管理页面添加或启用 VPS，部署模板会在这里选择目标节点后进入审批链路。</p>
				<Link href="/servers" className="mt-3 inline-flex rounded-lg border border-amber-300/40 px-3 py-1.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/10">去添加 VPS</Link>
			</div>
		);
	}

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setError(null);
		setPending(true);
		try {
			const form = e.currentTarget;
			const fd = new FormData(form);
			const vars: Record<string, string> = {};
			for (const name of variables) {
				const val = String(fd.get(`variables.${name}`) || "").trim();
				vars[name] = val;
			}
			const serverIds = fd.getAll("serverIds").map(String).filter(Boolean);
			if (serverIds.length === 0) {
				setError("请至少选择一台目标 VPS");
				setPending(false);
				return;
			}
			const reason = String(fd.get("reason") || "").trim();
			await csrfFetch("/api/deployments", {
				method: "POST",
				body: JSON.stringify({
					templateId: fd.get("templateId"),
					serverIds,
					variables: vars,
					reason: reason || undefined,
				}),
			});
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "提交失败");
		} finally {
			setPending(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="mt-4 grid gap-4">
			<div className="grid gap-3 md:grid-cols-2">
				<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
					部署模板
					<select
						name="templateId"
						value={templateId}
						onChange={(event) => setTemplateId(event.target.value)}
						className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100"
					>
						{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
					</select>
				</label>
				<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
					部署原因
					<input name="reason" maxLength={500} placeholder="例如：上线新版本 / 修复服务异常" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 light:placeholder:text-slate-400" />
				</label>
			</div>

			{selectedTemplate?.description && <p className="text-xs text-slate-500">{selectedTemplate.description}</p>}

			{variables.length > 0 ? (
				<div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4 light:border-cyan-200 light:bg-cyan-50">
					<div className="mb-3 flex items-center justify-between gap-3">
						<h3 className="text-sm font-semibold text-white">模板变量</h3>
						<span className="text-xs text-slate-500">全部必填，提交前会在后端再次校验。</span>
					</div>
					<div className="grid gap-3 md:grid-cols-2">
						{variables.map((name) => (
							<label key={name} className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
								{name}
								<input name={`variables.${name}`} required placeholder={`填写 ${name}`} className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 light:placeholder:text-slate-400" />
							</label>
						))}
					</div>
				</div>
			) : (
				<p className="rounded-xl border border-white/[0.06] bg-slate-950/60 px-4 py-3 text-xs text-slate-400">该模板没有变量，可直接选择目标 VPS 提交。</p>
			)}

			<div>
				<div className="mb-2 flex items-center justify-between gap-3">
					<h3 className="text-sm font-semibold text-white">目标 VPS</h3>
					<span className="text-xs text-slate-500">至少选择 1 台。</span>
				</div>
				<div className="grid gap-2 md:grid-cols-2">
					{servers.map((server) => (
						<label key={server.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
							<input type="checkbox" name="serverIds" value={server.id} />
							<span>{server.name} · {server.username}@{server.host}</span>
						</label>
					))}
				</div>
			</div>

			<details className="rounded-xl border border-white/[0.06] bg-slate-950/60 p-3">
				<summary className="cursor-pointer text-xs font-medium text-[var(--text-secondary)]">预览命令</summary>
				<code className="mt-3 block max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-slate-950/70 p-3 font-mono text-xs text-slate-300">{previewCommand(selectedTemplate, variables)}</code>
			</details>

			{error && <p className="text-xs text-rose-300">{error}</p>}
			<button disabled={pending} className="w-fit rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60">{pending ? "提交中..." : "提交部署审批"}</button>
		</form>
	);
}
