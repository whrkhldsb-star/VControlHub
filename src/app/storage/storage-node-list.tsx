"use client";

import { useState, useTransition } from "react";

import { checkStorageNodeHealthAction } from "./actions";
import { EmptyState } from "@/components/page-shell";
import { StorageNodeEditForm } from "./storage-node-edit-form";
import { StorageNodeDeleteButton } from "./storage-node-delete-button";

type StorageNodeItem = {
	id: string;
	name: string;
	driver: string;
	basePath: string;
	isDefault: boolean;
	host?: string | null;
	port?: number | null;
	username?: string | null;
	serverId?: string | null;
	connectionSummary: string;
	directAccess: { mode: string; description: string; href: string | null };
	fileCount: number;
	healthStatus?: "UNKNOWN" | "HEALTHY" | "UNHEALTHY" | string | null;
	lastHealthCheckAt?: string | null;
	lastHealthError?: string | null;
	lastHealthLatencyMs?: number | null;
};

export function StorageNodeList({
	nodes,
	servers,
	canManageNodes,
}: {
	nodes: StorageNodeItem[];
	servers: Array<{ id: string; name: string; host: string }>;
	canManageNodes: boolean;
}) {
	if (nodes.length === 0) {
		return <EmptyState variant="boxed">暂无存储节点。</EmptyState>;
	}

	return (
		<div className="space-y-4">
			{nodes.map((node) => (
				<StorageNodeCard key={node.id} node={node} servers={servers} canManageNodes={canManageNodes} />
			))}
		</div>
	);
}

function getHealthPresentation(status?: string | null) {
	switch (status) {
		case "HEALTHY":
			return { label: "健康", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" };
		case "UNHEALTHY":
			return { label: "异常", className: "border-rose-400/30 bg-rose-400/10 text-rose-100" };
		default:
			return { label: "未检测", className: "border-slate-400/30 bg-slate-400/10 text-slate-200" };
	}
}

function formatHealthTime(value?: string | null) {
	if (!value) return "未检测";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString("zh-CN", { hour12: false });
}

function StorageNodeCard({
	node,
	servers,
	canManageNodes,
}: {
	node: StorageNodeItem;
	servers: Array<{ id: string; name: string; host: string }>;
	canManageNodes: boolean;
}) {
	const [editing, setEditing] = useState(false);
	const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
	const [isPending, startTransition] = useTransition();
	const health = getHealthPresentation(node.healthStatus);

	function handleHealthCheck() {
		setMessage(null);
		startTransition(async () => {
			const result = await checkStorageNodeHealthAction(node.id);
			if (result.success) {
				setMessage({ text: result.success, ok: true });
			} else if (result.error) {
				setMessage({ text: result.error, ok: false });
			}
		});
	}

	return (
		<article className="rounded-2xl border border-[var(--border)] bg-white/5 p-5">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-lg font-medium text-white">{node.name}</h3>
					<p className="mt-2 text-sm leading-7 text-slate-300">{node.connectionSummary}</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
						{node.isDefault ? "默认节点" : node.driver}
					</span>
					{canManageNodes ? (
						<>
							<button
								type="button"
								onClick={() => setEditing((prev) => !prev)}
								title={editing ? "收起" : "编辑"}
								className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-100 transition hover:bg-cyan-400/20"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
							</button>
							{!editing ? (
								<StorageNodeDeleteButton storageNodeId={node.id} nodeName={node.name} />
							) : null}
						</>
					) : null}
				</div>
			</div>
			<p className="mt-3 text-sm text-cyan-100">
				{node.directAccess.href ? (
					<a href={node.directAccess.href} target="_blank" rel="noopener noreferrer" className="underline decoration-cyan-400/40 underline-offset-2 hover:text-cyan-50">
						{node.directAccess.description}
					</a>
				) : (
					node.directAccess.description
				)}
			</p>
			<div className="mt-4 rounded-2xl border border-[var(--border)] bg-slate-950/40 p-4 text-sm text-slate-300">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<span className={`rounded-full border px-3 py-1 text-xs ${health.className}`}>{health.label}</span> <span>最近检测：{formatHealthTime(node.lastHealthCheckAt)}</span> {node.lastHealthLatencyMs != null ? <span>{node.lastHealthLatencyMs} ms</span> : null} </div> {canManageNodes ? ( <button type="button" onClick={handleHealthCheck} disabled={isPending} className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-medium text-sky-100 transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60" > {isPending ?"检测中..." :"立即检测"} </button> ) : null} </div> {node.lastHealthError ? <p className="mt-2 text-xs text-amber-200">{node.lastHealthError}</p> : null} {message ? <p className={`mt-2 text-xs ${message.ok ? "text-emerald-200" : "text-rose-200"}`}>{message.text}</p> : null}
			</div>
			<p className="mt-2 text-xs text-slate-400">已登记文件：{node.fileCount}</p>

		{editing ? (
			<div className="mt-4">
				<StorageNodeEditForm node={node} servers={servers} />
			</div>
		) : null}
		</article>
	);
}
