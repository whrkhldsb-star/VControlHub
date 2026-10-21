"use client";

/**
 * Left column of the drive, as standard cards: quick access (all files,
 * favorites, recent, tags, background tasks), the storage locations with
 * their health, and the folder tree of the selected location. The recycle
 * bin is a tab of the files section, like on its other pages.
 */
import { useState, type ReactNode } from "react";

import { ChevronRight, Clock, Folder, Globe, HardDrive, Home, ListIcon, Server, Star, Tag } from "@/components/icons";
import { Card } from "@/components/page-shell";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import type { FilesApiResponse, TreeNode, TreeRootNode } from "./files-browser-helpers";
import { FileOperationTasks } from "./file-operation-controls";
import type { FileCollectionMode } from "./file-preferences-client";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

const ITEM_CLASS = "flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-left text-sm transition-colors";
const ITEM_IDLE = "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]";
// Selected like any chosen item on a page, not like the app navigation.
const ITEM_ACTIVE = "bg-[var(--color-action-bg)] font-medium text-[var(--color-action-text)]";

function NavCount({ children }: { children: ReactNode }) {
	return <span className="ml-auto shrink-0 text-xs tabular-nums text-[var(--text-muted)]">{children}</span>;
}

function NodeIcon({ driver }: { driver: string }) {
	const Icon = driver === "SFTP" ? Server : driver === "WEBDAV" ? Globe : HardDrive;
	return <Icon size={16} className="shrink-0" aria-hidden />;
}

function HealthDot({ status, t }: { status?: string | null; t: TFn }) {
	const tone = status === "HEALTHY" ? "var(--success)" : status === "UNHEALTHY" ? "var(--danger)" : "var(--text-disabled)";
	const label = status === "HEALTHY" ? t("storagePage.list.health") : status === "UNHEALTHY" ? t("storagePage.list.error") : t("storagePage.list.unchecked");
	return <span role="img" aria-label={label} title={label} className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} />;
}

export function DriveSidebar({
	t,
	data,
	mobileOpen,
	expandedTreePaths,
	onToggleTreePath,
	onSelectNode,
	onTreeNavigate,
	onOpenCollection,
}: {
	t: TFn;
	data: FilesApiResponse;
	mobileOpen: boolean;
	expandedTreePaths: Set<string>;
	onToggleTreePath: (path: string) => void;
	onSelectNode: (nodeId: string) => void;
	onTreeNavigate: (path: string) => void;
	onOpenCollection: (mode: FileCollectionMode) => void;
}) {
	const [nodeQuery, setNodeQuery] = useState("");
	const atRoot = !data.nodeIdFilter && !data.currentPath && !data.searchQuery;
	const query = nodeQuery.trim().toLowerCase();
	const nodes = query
		? data.nodes.filter((node) => `${node.name} ${node.teamName ?? ""} ${node.driver}`.toLowerCase().includes(query))
		: data.nodes;
	const showTree = Boolean(data.nodeIdFilter) && Boolean(data.tree.children?.length);
	// A customer name under every location is noise when they all share one.
	const manyCustomers = new Set(data.nodes.map((node) => node.teamName).filter(Boolean)).size > 1;

	return (
		<aside
			id="files-browser-sidebar"
			aria-label={t("filesBrowserSpa.sidebarAria")}
			className={cn("min-w-0 flex-col gap-4 lg:sticky lg:top-4", mobileOpen ? "flex" : "hidden lg:flex")}
		>
			<Card padding="sm" title={t("filesPage.drive.quickAccess")}>
				<nav aria-label={t("filesPage.drive.quickAccess")} className="-mx-1 flex flex-col gap-0.5">
					<button type="button" onClick={() => onSelectNode("")} aria-current={atRoot ? "page" : undefined} className={cn(ITEM_CLASS, atRoot ? ITEM_ACTIVE : ITEM_IDLE)}>
						<Home size={16} className="shrink-0" aria-hidden />
						<span className="truncate">{t("filesBrowserSpa.allFiles")}</span>
						<NavCount>{data.stats.totalEntries}</NavCount>
					</button>
					<button type="button" onClick={() => onOpenCollection("favorites")} className={cn(ITEM_CLASS, ITEM_IDLE)}>
						<Star size={16} className="shrink-0" aria-hidden />
						<span className="truncate">{t("filePreferences.favorites")}</span>
					</button>
					<button type="button" onClick={() => onOpenCollection("recent")} className={cn(ITEM_CLASS, ITEM_IDLE)}>
						<Clock size={16} className="shrink-0" aria-hidden />
						<span className="truncate">{t("filePreferences.recent")}</span>
					</button>
					<button type="button" onClick={() => onOpenCollection("tags")} className={cn(ITEM_CLASS, ITEM_IDLE)}>
						<Tag size={16} className="shrink-0" aria-hidden />
						<span className="truncate">{t("filePreferences.tags")}</span>
					</button>
					<FileOperationTasks
						trigger={({ active, open }) => (
							<button type="button" onClick={open} className={cn(ITEM_CLASS, ITEM_IDLE)}>
								<ListIcon size={16} className="shrink-0" aria-hidden />
								<span className="truncate">{t("fileOperations.tasks")}</span>
								{active > 0 ? (
									<span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--color-action)] px-1.5 text-[11px] font-semibold text-[var(--solid-action-fg)]">
										{active}
									</span>
								) : null}
							</button>
						)}
					/>
				</nav>
			</Card>

			<Card as="section" aria-label={t("filesPage.drive.locations")} padding="sm" title={t("filesPage.drive.locations")}>
				<div className="-mx-1 flex flex-col gap-1.5">
					{data.nodes.length > 6 ? (
						<input
							type="search"
							value={nodeQuery}
							onChange={(event) => setNodeQuery(event.currentTarget.value)}
							placeholder={t("filesBrowserSpa.searchPlaceholder")}
							aria-label={t("filesBrowserSpa.searchStorageNode")}
							className={cn(UI_INPUT, "h-8 text-xs")}
						/>
					) : null}
					<ul className="flex flex-col gap-0.5">
						{nodes.map((node) => {
							const active = node.id === data.nodeIdFilter;
							return (
								<li key={node.id}>
									<button
										type="button"
										onClick={() => onSelectNode(node.id)}
										aria-current={active && !data.currentPath ? "page" : undefined}
										title={`${node.name}${node.teamName ? ` · ${node.teamName}` : ""} · ${getStorageDriverLabel(t, node.driver)}`}
										className={cn(ITEM_CLASS, "min-h-11 py-1.5", active ? ITEM_ACTIVE : ITEM_IDLE)}
									>
										<NodeIcon driver={node.driver} />
										<span className="min-w-0 flex-1">
											<span className="block truncate">{node.name}</span>
											<span className="block truncate text-xs font-normal text-[var(--text-muted)]">
												{(manyCustomers && node.teamName) || getStorageDriverLabel(t, node.driver)}
											</span>
										</span>
										<HealthDot status={node.healthStatus} t={t} />
									</button>
								</li>
							);
						})}
						{nodes.length === 0 ? <li className="px-2.5 py-1 text-xs text-[var(--text-muted)]">{t("filesBrowserSpa.noMatchingNode")}</li> : null}
					</ul>
				</div>
			</Card>

			{showTree ? (
				<Card as="section" aria-label={t("filesBrowserSpa.directoryTree")} padding="sm" title={t("filesBrowserSpa.directoryTree")}>
					<div className="-mx-1 max-h-[50dvh] overflow-y-auto">
						<FolderTree
							t={t}
							node={data.tree}
							currentPath={data.currentPath}
							onNavigate={onTreeNavigate}
							expandedPaths={expandedTreePaths}
							onToggle={onToggleTreePath}
						/>
					</div>
				</Card>
			) : null}
		</aside>
	);
}

function FolderTree({ t, node, currentPath, onNavigate, expandedPaths, onToggle, depth = 0 }: {
	t: TFn;
	node: TreeRootNode | TreeNode;
	currentPath: string;
	onNavigate: (path: string) => void;
	expandedPaths: Set<string>;
	onToggle: (path: string) => void;
	depth?: number;
}) {
	const children = node.children;
	if (!children || children.length === 0) return null;
	return (
		<ul className="flex flex-col gap-0.5">
			{children.map((child) => {
				const isCurrent = child.path === currentPath;
				const hasChildren = Boolean(child.children?.length);
				const isExpanded = expandedPaths.has(child.path);
				const name = child.displayName ?? child.name;
				return (
					<li key={child.path || child.name}>
						<div className={cn("flex min-w-0 items-center rounded-[var(--radius-control)]", isCurrent ? ITEM_ACTIVE : ITEM_IDLE)} style={{ paddingLeft: `${depth * 0.75}rem` }}>
							<button
								type="button"
								onClick={() => (hasChildren ? onToggle(child.path) : onNavigate(child.path))}
								aria-label={hasChildren
									? `${isExpanded ? t("filesBrowserSpa.collapseNode") : t("filesBrowserSpa.expandNode")} ${name}`
									: t("filesBrowserSpa.openChild", { name })}
								aria-expanded={hasChildren ? isExpanded : undefined}
								className="grid h-8 w-6 shrink-0 place-items-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
							>
								{hasChildren ? <ChevronRight size={14} className={cn("transition-transform", isExpanded && "rotate-90")} aria-hidden /> : <span className="h-1 w-1 rounded-full bg-current opacity-50" aria-hidden />}
							</button>
							<button
								type="button"
								onClick={() => onNavigate(child.path)}
								aria-current={isCurrent ? "page" : undefined}
								aria-label={name}
								title={name}
								className="flex min-h-8 min-w-0 flex-1 items-center gap-2 pr-2 text-left text-sm"
							>
								<Folder size={15} className="shrink-0 text-[var(--accent)]" aria-hidden />
								<span className="truncate">{name}</span>
							</button>
						</div>
						{hasChildren && isExpanded ? (
							<FolderTree t={t} node={child} currentPath={currentPath} onNavigate={onNavigate} expandedPaths={expandedPaths} onToggle={onToggle} depth={depth + 1} />
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
