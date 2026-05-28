import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getStorageOverview } from "@/lib/storage/service";
import { getSftpSyncNode, syncSftpDirectoryEntries } from "@/lib/storage/sftp-sync";
import {
	buildFileTree,
	findFileTreeNode,
	normalizeFilePath,
	searchFileTree,
	serializeFileTreeFolder,
	serializeFileTreeNode,
} from "@/lib/files/tree";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
	try {
		const session = await requireSession();
		const canEditLocalFiles = sessionHasPermission(session, "storage:write");
		const canDelete = sessionHasPermission(session, "storage:delete");
		const canManageNodes = sessionHasPermission(session, "storage:manage-node");

		const searchParams = request.nextUrl.searchParams;
		const currentPath = normalizeFilePath(searchParams.get("path") ?? undefined);
		const searchQuery = (searchParams.get("q") ?? "").trim();
		const searchScope = searchParams.get("scope") === "all" ? "all" : "current";
		const nodeIdFilter = searchParams.get("nodeId") ?? "";

		let storage = await getStorageOverview();

		if (nodeIdFilter) {
			const selectedNode = storage.nodes.find((node) => node.id === nodeIdFilter);
			const selectedEntries = storage.entries.filter((entry) => entry.storageNode.id === nodeIdFilter);
			if (selectedNode?.driver === "SFTP" && selectedEntries.length === 0 && canEditLocalFiles) {
				const syncNode = await getSftpSyncNode(nodeIdFilter);
				if (syncNode?.driver === "SFTP") {
					await syncSftpDirectoryEntries({ node: syncNode, recursive: false, maxDepth: 1 });
					storage = await getStorageOverview();
				}
			}
		}

		// Filter entries by nodeId if specified
		const filteredEntries = nodeIdFilter
			? storage.entries.filter((e) => e.storageNode.id === nodeIdFilter)
			: storage.entries;
		const filteredDirectories = nodeIdFilter
			? storage.remoteDirectories.filter((d) => d.storageNodeId === nodeIdFilter)
			: storage.remoteDirectories;

		// When no specific node is selected, group entries by node to avoid
		// mixing SFTP root directories with LOCAL directories at root level
		const groupByNode = !nodeIdFilter;
		const tree = buildFileTree(filteredEntries, filteredDirectories, groupByNode);
		const currentNode = findFileTreeNode(tree, currentPath) ?? tree;

		let folders = [...currentNode.folders.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
		let files = [...currentNode.files].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

		// Apply search filter
		if (searchQuery) {
			const lowerQuery = searchQuery.toLowerCase();
			if (searchScope === "all") {
				const allResults = searchFileTree(tree, searchQuery);
				folders = allResults.folders;
				files = allResults.files;
			} else {
				folders = folders.filter((f) => f.name.toLowerCase().includes(lowerQuery));
				files = files.filter((e) => e.name.toLowerCase().includes(lowerQuery));
			}
		}

		const sourceSummary = [...currentNode.sources.values()];
		const totalItems = folders.length + files.length;

		return NextResponse.json({
			currentPath,
			nodeIdFilter,
			folders: folders.map(serializeFileTreeFolder),
			files: files.map((entry) => ({
				id: entry.id,
				name: entry.name,
				entryType: entry.entryType,
				mimeType: entry.mimeType ?? null,
				relativePath: entry.relativePath,
				sizeLabel: entry.sizeLabel,
				previewable: entry.previewable,
				directAccessMode: entry.directAccess.mode,
				directAccessHref: entry.directAccess.href ?? null,
				directAccessFallbackHref: "fallbackHref" in entry.directAccess ? entry.directAccess.fallbackHref : null,
				directAccessDescription: entry.directAccess.description,
				storageNodeId: entry.storageNode.id,
				storageNodeName: entry.storageNode.name,
				storageNodeDriver: entry.storageNode.driver,
				updatedAt: "updatedAt" in entry && entry.updatedAt ? String(entry.updatedAt) : null,
			})),
			tree: {
				name: tree.name,
				path: tree.path,
				children: serializeFileTreeNode(tree),
			},
			stats: {
				...storage.stats,
				totalItems,
			},
			sourceSummary,
			searchQuery,
			searchScope,
			permissions: {
				canEditLocalFiles,
				canDelete,
				canManageNodes,
			},
			nodes: storage.nodes.map((n) => ({ id: n.id, name: n.name, driver: n.driver })),
		});
	} catch (error) {
		if (error instanceof Error && error.message.includes("Unauthorized")) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Internal server error" },
			{ status: 500 },
		);
	}
}
