"use client";

import { useState } from "react";

import { StorageNodeList } from "@/app/storage/storage-node-list";
import { StorageNodeCreateForm } from "@/app/storage/storage-node-create-form";

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

export function StorageNodeManager({
	nodes,
	servers,
	canManageNodes,
}: {
	nodes: StorageNodeItem[];
	servers: Array<{ id: string; name: string; host: string }>;
	canManageNodes: boolean;
}) {
	const [expanded, setExpanded] = useState(false);

	const localCount = nodes.filter((n) => n.driver === "LOCAL").length;
	const sftpCount = nodes.filter((n) => n.driver === "SFTP").length;

	return (
		<section id="storage-nodes" className="scroll-mt-24 rounded-3xl border border-white/10 light:border-slate-200 bg-slate-900/60 light:bg-white/60 p-6">
			<div className="flex items-center justify-between gap-4">
				<div>
					<h2 className="text-2xl font-semibold text-white">存储节点</h2>
					<p className="mt-2 text-sm leading-7 text-slate-300 light:text-slate-700">
						{nodes.length} 个节点 · 本机 {localCount} · SFTP {sftpCount}
					</p>
				</div>
				<button
					type="button"
					onClick={() => setExpanded((prev) => !prev)}
					className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 light:text-cyan-900 transition hover:bg-cyan-400/20"
				>
					{expanded ? "收起" : "展开"}
				</button>
			</div>

			{expanded ? (
				<div className="mt-6 space-y-6">
					<StorageNodeList nodes={nodes} servers={servers} canManageNodes={canManageNodes} />
					{canManageNodes ? (
						<StorageNodeCreateForm servers={servers} />
					) : null}
				</div>
			) : null}
		</section>
	);
}
