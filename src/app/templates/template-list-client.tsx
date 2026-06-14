"use client";

import { useState, useCallback, useId } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { EmptyState } from "@/components/page-shell";

type Template = {
	id: string; name: string; description: string | null;
	command: string; rollbackCommand?: string | null; variables: string[]; tags: string[];
	isBuiltin: boolean; createdAt: string;
	creator: { username: string; displayName: string | null } | null;
};

type ServerOption = { id: string; name: string; enabled: boolean };

type Props = {
	templates: Template[];
	servers: ServerOption[];
	canCreate: boolean;
	canDeploy?: boolean;
};

export function TemplateListClient({ templates: initialTemplates, servers, canCreate, canDeploy = false }: Props) {
	const { addToast } = useToast();
	const [templates, setTemplates] = useState(initialTemplates);
	const [showCreate, setShowCreate] = useState(false);
	const [filterTag, setFilterTag] = useState<string | null>(null);
	const [deploying, setDeploying] = useState<string | null>(null);
	const [templatePendingDelete, setTemplatePendingDelete] = useState<Template | null>(null);

	const allTags = [...new Set(templates.flatMap((t) => t.tags))].sort();

	const filtered = filterTag
		? templates.filter((t) => t.tags.includes(filterTag))
		: templates;

	const refresh = useCallback(async () => {
		const data = await csrfFetch("/api/command-templates");
		setTemplates(data.templates ?? []);
	}, []);

	const handleDelete = useCallback(async (id: string) => {
		try {
			await csrfFetch(`/api/command-templates?id=${id}`, { method: "DELETE" });
			setTemplatePendingDelete(null);
			await refresh();
			addToast("success", "模板已删除");
		} catch (err) {
			addToast("error", err instanceof Error ? err.message : "删除失败");
		}
	}, [addToast, refresh]);

	const handleDeploy = useCallback(async (template: Template, serverIds: string[], vars: Record<string, string>) => {
		const missingVariable = template.variables.find((name) => !vars[name]?.trim());
		if (missingVariable) {
			addToast("error", `请填写变量 ${missingVariable} 后再提交部署`);
			return;
		}
		setDeploying(template.id);
		try {
			await csrfFetch("/api/deployments", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					templateId: template.id,
					serverIds,
					variables: vars,
					reason: `从模板中心下发：${template.name}`,
				}),
			});
			addToast("success", "部署已提交，可在部署记录中查看进度");
		} catch (err) {
			addToast("error", err instanceof Error ? err.message : "提交失败");
		}
		setDeploying(null);
	}, [addToast]);

	return (
		<div className="space-y-6">
			{templatePendingDelete && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-template-title">
					<div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-slate-950 p-5 shadow-2xl shadow-black/30">
						<h3 id="delete-template-title" className="text-base font-semibold text-white">删除命令模板</h3>
						<p className="mt-2 text-sm text-slate-400">确认删除模板 <span className="font-medium text-slate-100">{templatePendingDelete.name}</span>？此操作不可恢复。</p>
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setTemplatePendingDelete(null)}
								data-card className="min-h-11 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.06]"
							>
								取消
							</button>
							<button
								type="button"
								onClick={() => handleDelete(templatePendingDelete.id)}
								className="min-h-11 rounded-xl border border-rose-400/30 bg-rose-500/15 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/25"
							>
								确认删除
							</button>
						</div>
					</div>
				</div>
			)}
			{/* Controls */}
			<div className="flex items-center justify-between flex-wrap gap-3">
				{/* Tag filter */}
				{allTags.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-xs text-slate-500">筛选</span>
						<button
							onClick={() => setFilterTag(null)}
							data-tone={!filterTag ? "accent" : undefined}
							className={`rounded-md border px-2 py-0.5 text-[11px] transition ${!filterTag ? "" : "border-white/[0.06] bg-white/[0.02] text-slate-500 hover:bg-white/[0.05]"}`}
						>
							全部
						</button>
						{allTags.map((tag) => (
							<button
								key={tag}
								onClick={() => setFilterTag(filterTag === tag ? null : tag)}
								data-tone={filterTag === tag ? "accent" : undefined}
								className={`rounded-md border px-2 py-0.5 text-[11px] transition ${filterTag === tag ? "" : "border-white/[0.06] bg-white/[0.02] text-slate-500 hover:bg-white/[0.05]"}`}
							>
								#{tag}
							</button>
						))}
					</div>
				)}
				{canCreate && !showCreate && (
					<button
						onClick={() => setShowCreate(true)}
						data-tone="accent"
						className="min-h-11 rounded-2xl border px-5 py-2.5 text-sm font-medium transition"
					>
						+ 创建模板
					</button>
				)}
			</div>

			{showCreate && (
				<CreateTemplateForm onClose={() => { setShowCreate(false); refresh(); }} />
			)}

			{/* Template grid */}
			{filtered.length === 0 ? (
				<EmptyState icon="📝" variant="boxed">
					暂无命令模板
				</EmptyState>
			) : (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{filtered.map((tmpl) => (
						<article key={tmpl.id} data-card className=" p-4 hover:bg-white/[0.04] transition-colors duration-150 flex flex-col">
							<div className="flex items-start justify-between gap-2">
								<div>
									<h3 className="text-sm font-semibold text-white">{tmpl.name}</h3>
									{tmpl.description && <p className="mt-0.5 text-[11px] text-slate-500">{tmpl.description}</p>}
								</div>
								{tmpl.isBuiltin && (
									<span data-tone="accent" className="rounded-md border px-1.5 py-0.5 text-[9px] font-medium shrink-0">内置</span>
								)}
							</div>
							<div className="mt-2.5 rounded-lg border border-white/[0.06] bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-300 line-clamp-2">
								{tmpl.command}
							</div>
							{tmpl.rollbackCommand && (
								<div className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 font-mono text-xs text-emerald-100 line-clamp-2 light:border-emerald-200 light:bg-emerald-50">
									<span className="mr-2 font-sans text-[10px] uppercase tracking-[0.2em] text-emerald-300">Rollback</span>{tmpl.rollbackCommand}
								</div>
							)}
							{tmpl.variables.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-1">
{tmpl.variables.map((v) => {
											const placeholder = `{{${v}}}`;
											return <span key={v} data-tone="warning" className="rounded-md border px-1.5 py-0.5 text-[10px] font-mono">{placeholder}</span>;
										})}
								</div>
							)}
							{tmpl.tags.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-1">
									{tmpl.tags.map((tag) => (
										<span key={tag} className="rounded-md bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-500">#{tag}</span>
									))}
								</div>
							)}
							<div className="mt-3 flex items-center gap-2 pt-2 border-t border-white/[0.04]">
								{canDeploy && (
									<DeployButton
										template={tmpl}
										servers={servers}
										onDeploy={handleDeploy}
										loading={deploying === tmpl.id}
									/>
								)}
								{canCreate && !tmpl.isBuiltin && (
									<button
										onClick={() => setTemplatePendingDelete(tmpl)}
										className="min-h-11 min-w-11 text-[11px] text-rose-400/60 hover:text-rose-300 transition"
									>
										删除
									</button>
								)}
							</div>
						</article>
					))}
				</div>
			)}
		</div>
	);
}

/* ── Deploy button with variable form + server select ─────── */

function DeployButton({ template, servers, onDeploy, loading }: {
	template: Template; servers: ServerOption[];
	onDeploy: (t: Template, s: string[], v: Record<string, string>) => void;
	loading: boolean;
}) {
	const deployFormId = useId();
	const [open, setOpen] = useState(false);
	const [vars, setVars] = useState<Record<string, string>>({});
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	if (!open) {
		return (
			<button
				onClick={() => setOpen(true)}
				className="min-h-11 rounded-lg bg-cyan-500/80 px-3 py-1 text-[11px] font-medium text-slate-950 hover:bg-cyan-400 transition"
			>
				一键下发
			</button>
		);
	}

	const enabledServers = servers.filter((s) => s.enabled);

	return (
		<div className="w-full space-y-2.5">
			{template.variables.map((v) => {
				const variableInputId = `${deployFormId}-${v}`;
				const variableLabel = `变量 ${v}`;
				return (
				<div key={v} className="flex items-center gap-2">
					<label htmlFor={variableInputId} className="text-[11px] text-amber-200 font-mono w-24 shrink-0">{variableLabel}</label>
					<input
						id={variableInputId}
						value={vars[v] ?? ""}
					onChange={(e) => setVars((prev) => ({ ...prev, [v]: e.target.value }))}
						placeholder={`{{${v}}}`}
						className="flex-1 rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[11px] text-white font-mono outline-none placeholder:text-white/20 light:placeholder:text-slate-400 focus:border-cyan-400/30"
					/>
				</div>
			);})}
			<div className="flex flex-wrap gap-1">
				{enabledServers.map((s) => (
					<label key={s.id} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] cursor-pointer transition ${selectedIds.has(s.id) ? "border-cyan-400/20 bg-cyan-400/[0.06] text-white" : "border-white/[0.06] bg-white/[0.03] text-slate-400"}`}>
						<input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => {
							setSelectedIds((prev) => { const n = new Set(prev); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; });
						}} className="accent-cyan-400" />
						{s.name}
					</label>
				))}
			</div>
			<div className="flex gap-2">
				<button
					onClick={() => onDeploy(template, [...selectedIds], vars)}
					disabled={loading || selectedIds.size === 0}
					className="min-h-11 rounded-lg bg-cyan-500 px-3 py-1 text-[11px] font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60 transition"
				>
					{loading ? "提交中…" : "提交部署"}
				</button>
				<button onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] text-slate-400 hover:bg-white/[0.06] transition">
					取消
				</button>
			</div>
		</div>
	);
}

/* ── Create template form ─────────────────────────────────── */

function CreateTemplateForm({ onClose }: { onClose: () => void }) {
	const createFormId = useId();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [command, setCommand] = useState("");
	const [rollbackCommand, setRollbackCommand] = useState("");
	const [tags, setTags] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const _data = await csrfFetch("/api/command-templates", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name, description: description || null, command, rollbackCommand: rollbackCommand.trim() || null,
					tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
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
		<form onSubmit={handleSubmit} data-card className=" p-5 space-y-4">
			<h3 className="text-lg font-semibold text-white">创建命令模板</h3>
			{error && <div className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200">{error}</div>}
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-name`} className="text-xs font-medium text-white/50 tracking-wide">模板名称</label>
				<input id={`${createFormId}-name`} value={name} onChange={(e) => setName(e.target.value)} required placeholder="例如：Docker Compose 更新" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30" />
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-description`} className="text-xs font-medium text-white/50 tracking-wide">描述</label>
				<input id={`${createFormId}-description`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="可选说明" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30" />
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-command`} className="text-xs font-medium text-white/50 tracking-wide">命令内容</label>
				<textarea id={`${createFormId}-command`} value={command} onChange={(e) => setCommand(e.target.value)} required rows={3} placeholder="cd {{project_dir}} && docker compose up -d" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white font-mono outline-none transition placeholder:text-white/20 light:placeholder:text-slate-400 focus:border-cyan-400/30 resize-y" />
				<p className="text-[11px] text-slate-600">使用 `{"{{变量名}}"}` 作为占位符，下发时填入实际值</p>
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-rollback-command`} className="text-xs font-medium text-white/50 tracking-wide">回滚命令（可选）</label>
				<textarea id={`${createFormId}-rollback-command`} value={rollbackCommand} onChange={(e) => setRollbackCommand(e.target.value)} rows={3} placeholder="cd {{project_dir}} && docker compose up -d previous" className="w-full rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] px-3.5 py-2.5 text-sm text-white light:border-emerald-200 light:bg-emerald-50 font-mono outline-none transition placeholder:text-white/20 light:placeholder:text-slate-400 focus:border-emerald-400/40 resize-y" />
				<p className="text-[11px] text-slate-600">部署运行会保存这份命令快照；之后“真实回滚”会执行快照里的回滚命令，而不是重发部署命令。</p>
			</div>
			<div className="space-y-1.5">
				<label htmlFor={`${createFormId}-tags`} className="text-xs font-medium text-white/50 tracking-wide">标签（逗号分隔）</label>
				<input id={`${createFormId}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="docker, deploy" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30" />
			</div>
			<div className="flex gap-3 pt-2">
				<button type="submit" disabled={submitting} className="min-h-11 rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60">
					{submitting ? "创建中…" : "创建模板"}
				</button>
				<button type="button" onClick={onClose} className="min-h-11 rounded-2xl border border-[var(--border)] px-5 py-2 text-sm text-slate-300 hover:bg-white/10 transition">
					取消
				</button>
			</div>
		</form>
	);
}
