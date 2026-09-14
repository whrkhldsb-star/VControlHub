"use client";

import { useState } from "react";

import { StorageNodeList } from "@/app/storage/storage-node-list";
import { StorageNodeCreateForm } from "@/app/storage/storage-node-create-form";
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";

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
	servers: Array<{ id: string; name: string; host: string; storageNodeId?: string | null }>;
	canManageNodes: boolean;
}) {
	const { t } = useI18n();
	const [expanded, setExpanded] = useState(false);

	const localCount = nodes.filter((n) => n.driver === "LOCAL").length;
	const sftpCount = nodes.filter((n) => n.driver === "SFTP").length;
	const serversWithoutStorage = servers.filter((server) => !server.storageNodeId);

	return (
		<section id="storage-nodes" className="scroll-mt-24 border-y border-[var(--border)] py-4">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h2 className="text-base font-semibold text-[var(--text-primary)]">{t("storagePage.nodes.title")}</h2>
					<p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">
						{t("storagePage.nodes.summary", { total: nodes.length, local: localCount, sftp: sftpCount })} · WebDAV: {nodes.filter((node) => node.driver === "WEBDAV").length}
					</p>
				</div>
				<ActionButton
					variant="outline"
					onClick={() => setExpanded((prev) => !prev)}
					aria-expanded={expanded}
					className="shrink-0 px-3 py-2 text-sm"
				>
					{expanded ? t("common.collapse") : t("common.expand")}
				</ActionButton>
			</div>

			{expanded ? (
				<div className="mt-6 space-y-6">
					<StorageNodeList nodes={nodes} servers={servers} canManageNodes={canManageNodes} />
					{canManageNodes ? (
						<StorageNodeCreateForm servers={serversWithoutStorage} />
					) : null}
				</div>
			) : null}
		</section>
	);
}
