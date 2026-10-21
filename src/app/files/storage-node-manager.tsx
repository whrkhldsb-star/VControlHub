"use client";

import { useState } from "react";

import { StorageNodeList } from "@/app/storage/storage-node-list";
import { StorageNodeCreateForm } from "@/app/storage/storage-node-create-form";
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";
import { HardDrive } from "@/components/icons";
import { Dialog } from "@/components/ui/dialog";

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
	teamName?: string | null;
	directAccess: { mode: string; description: string; href: string | null };
	fileCount: number;
	healthStatus?: "UNKNOWN" | "HEALTHY" | "UNHEALTHY" | string | null;
	lastHealthCheckAt?: string | null;
	lastHealthError?: string | null;
	lastHealthLatencyMs?: number | null;
};

/**
 * Storage node management, opened from the page header: the drive itself
 * stays the page, and node health, edits and new nodes live one click away.
 */
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
	const [open, setOpen] = useState(false);

	const localCount = nodes.filter((n) => n.driver === "LOCAL").length;
	const sftpCount = nodes.filter((n) => n.driver === "SFTP").length;
	const serversWithoutStorage = servers.filter((server) => !server.storageNodeId);

	return (
		<>
			<ActionButton variant="secondary" icon={<HardDrive aria-hidden />} onClick={() => setOpen(true)} aria-haspopup="dialog">
				{t("storagePage.nodes.title")}
			</ActionButton>
			<Dialog
				size="full"
				placement="top"
				open={open}
				onClose={() => setOpen(false)}
				title={t("storagePage.nodes.title")}
				description={`${t("storagePage.nodes.summary", { total: nodes.length, local: localCount, sftp: sftpCount })} · WebDAV ${nodes.filter((node) => node.driver === "WEBDAV").length}`}
			>
				<div id="storage-nodes" className="flex flex-col gap-6">
					<StorageNodeList nodes={nodes} servers={servers} canManageNodes={canManageNodes} />
					{canManageNodes ? <StorageNodeCreateForm servers={serversWithoutStorage} /> : null}
				</div>
			</Dialog>
		</>
	);
}
