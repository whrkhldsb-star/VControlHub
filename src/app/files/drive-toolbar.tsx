"use client";

/**
 * Header controls of the drive: breadcrumbs, the search bar, upload / new
 * folder, sort and view switches.
 */
import { useId, useRef, useState, type FormEvent, type RefObject } from "react";

import { ActionButton } from "@/components/action-button";
import { ArrowDownUp, ChevronRight, FolderPlus, Home, ListIcon, Search, Upload } from "@/components/icons";
import { IconLayoutGrid } from "@/components/nav-icons";
import { useToast } from "@/components/toast-provider";
import { Dialog } from "@/components/ui/dialog";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { FormField, Notice, SegmentedControl } from "@/components/ui-primitives";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { createFolderAction } from "../storage/actions";
import { validateEntryName } from "./file-actions";
import { getDisplaySegment, isNodeGroupSegment, splitPath, type FilesApiResponse } from "./files-browser-helpers";
import type { FileListSortDir, FileListSortKey } from "./file-list-model";
import { useViewMode } from "./use-view-mode";

type TFn = (key: string, vars?: Record<string, string | number>) => string;
type DriveNode = FilesApiResponse["nodes"][number];

/**
 * Home › node › folder › folder. Long paths keep the first and last two
 * crumbs and fold the middle into "…", which still leads up one level at a time.
 */
export function DriveBreadcrumbs({ t, path, nodes, nodeIdFilter, onNavigate, onRoot }: {
	t: TFn;
	path: string;
	nodes: DriveNode[];
	nodeIdFilter: string;
	onNavigate: (path: string) => void;
	onRoot: () => void;
}) {
	const node = nodes.find((item) => item.id === nodeIdFilter);
	const segments = splitPath(path);
	type Crumb = { key: string; label: string; onClick?: () => void; current: boolean };
	const crumbs: Crumb[] = [];
	if (node) crumbs.push({ key: "node", label: node.name, onClick: () => onNavigate(""), current: segments.length === 0 });
	segments.forEach((segment, index) => {
		const target = segments.slice(0, index + 1).join("/");
		const last = index === segments.length - 1;
		crumbs.push({
			key: target,
			label: (isNodeGroupSegment(segment) ? getDisplaySegment(segment, nodes) : segment) ?? segment,
			onClick: last ? undefined : () => onNavigate(target),
			current: last,
		});
	});
	const folded = crumbs.length > 4 ? [crumbs[0]!, { key: "…", label: "…", onClick: crumbs[crumbs.length - 3]!.onClick, current: false }, ...crumbs.slice(-2)] : crumbs;
	return (
		<nav aria-label={t("filesBrowserSpa.breadcrumbAria")} className="min-w-0 flex-1">
			<ol className="flex min-w-0 items-center gap-0.5 text-sm">
				<li className="shrink-0">
					<button type="button" onClick={onRoot} aria-current={crumbs.length === 0 ? "page" : undefined}
						className={cn("inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 hover:bg-[var(--surface-hover)]",
							crumbs.length === 0 ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]")}>
						<Home size={16} aria-hidden />
						<span className={crumbs.length === 0 ? undefined : "max-sm:sr-only"}>{t("filesBrowserSpa.allFiles")}</span>
					</button>
				</li>
				{folded.map((crumb) => (
					<li key={crumb.key} className="flex min-w-0 items-center gap-0.5">
						<ChevronRight size={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
						{crumb.current || !crumb.onClick ? (
							<span aria-current={crumb.current ? "page" : undefined} title={crumb.label}
								className="truncate px-1.5 font-semibold text-[var(--text-primary)]">{crumb.label}</span>
						) : (
							<button type="button" onClick={crumb.onClick} title={crumb.label}
								className="h-8 max-w-[11rem] truncate rounded-[var(--radius-control)] px-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
								{crumb.label}
							</button>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}

export type DriveSearchMode = "current" | "all" | "content";

export function DriveSearchBar({ value, onChange, mode, onModeChange, onSubmit, inputRef, busy }: {
	value: string;
	onChange: (value: string) => void;
	mode: DriveSearchMode;
	onModeChange: (mode: DriveSearchMode) => void;
	onSubmit: () => void;
	inputRef?: RefObject<HTMLInputElement | null>;
	busy?: boolean;
}) {
	const { t } = useI18n();
	const scopeId = useId();
	const placeholder = mode === "content"
		? t("filesBrowserSpa.contentSearchPlaceholder")
		: mode === "all" ? t("filesBrowserSpa.searchAllFiles") : t("filesBrowserSpa.searchCurrentFolder");
	return (
		<form
			role="search"
			onSubmit={(event: FormEvent) => {
				event.preventDefault();
				if (value.trim()) onSubmit();
			}}
			className="order-last flex w-full min-w-0 basis-full items-center gap-1.5 sm:order-none sm:w-auto sm:max-w-md sm:flex-1 sm:basis-auto"
		>
			<div className="relative min-w-0 flex-1">
				<Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
				<label htmlFor="files-search-query" className="sr-only">{t("filesBrowserSpa.searchFileName")}</label>
				<input
					ref={inputRef}
					id="files-search-query"
					type="search"
					value={value}
					onChange={(event) => onChange(event.currentTarget.value)}
					placeholder={placeholder}
					aria-busy={busy || undefined}
					className={cn(UI_INPUT, "h-9 pl-8")}
				/>
			</div>
			<label htmlFor={scopeId} className="sr-only">{t("filesBrowserSpa.searchScopeLabel")}</label>
			<select
				id={scopeId}
				value={mode}
				onChange={(event) => onModeChange(event.currentTarget.value as DriveSearchMode)}
				className={cn(UI_INPUT, "h-9 w-auto shrink-0 text-xs")}
			>
				<option value="current">{t("filesPage.searchScope.current")}</option>
				<option value="all">{t("filesPage.searchScope.all")}</option>
				<option value="content">{t("filesPage.drive.searchContentOption")}</option>
			</select>
		</form>
	);
}

/** "Upload" with files and whole folders; disabled until the viewer can write somewhere. */
export function UploadMenu({ disabled, onUploadFiles, onUploadFolder }: {
	disabled?: boolean;
	onUploadFiles: () => void;
	onUploadFolder: () => void;
}) {
	const { t } = useI18n();
	if (disabled) {
		return (
			<ActionButton variant="primary" icon={<Upload aria-hidden />} disabled>
				{t("filesPage.drive.upload")}
			</ActionButton>
		);
	}
	return (
		<Menu label={t("filesPage.drive.upload")} trigger={<><Upload aria-hidden size={16} />{t("filesPage.drive.upload")}</>} variant="primary" size="md" panelClassName="w-52">
			<MenuItem icon={<Upload aria-hidden />} onSelect={onUploadFiles}>{t("filesBrowserSpa.uploadFiles")}</MenuItem>
			<MenuItem icon={<FolderPlus aria-hidden />} onSelect={onUploadFolder}>{t("filesPage.drive.uploadFolder")}</MenuItem>
		</Menu>
	);
}

/** Mount it while open: every opening starts with an empty name. */
export function NewFolderDialog({ onClose, nodes, nodeId, currentPath, onCreated }: {
	onClose: () => void;
	nodes: DriveNode[];
	/** The node shown; without one the dialog asks where to create. */
	nodeId: string;
	currentPath: string;
	onCreated: () => void;
}) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const formId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const writable = nodes.filter((node) => ["LOCAL", "SFTP", "WEBDAV"].includes(node.driver));
	const [name, setName] = useState("");
	const [targetNode, setTargetNode] = useState(nodeId || writable[0]?.id || "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const reason = validateEntryName(name);

	return (
		<Dialog
			open
			onClose={onClose}
			busy={busy}
			title={t("common.newFolder")}
			description={nodeId ? `/${currentPath}` : undefined}
			initialFocusRef={inputRef}
			footer={<>
				<ActionButton variant="secondary" disabled={busy} onClick={onClose}>{t("common.cancel")}</ActionButton>
				<ActionButton type="submit" form={formId} loading={busy} disabled={Boolean(reason) || !targetNode}>{t("common.create")}</ActionButton>
			</>}
		>
			<form
				id={formId}
				noValidate
				className="flex flex-col gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					if (busy || reason || !targetNode) return;
					setBusy(true);
					setError("");
					const formData = new FormData();
					formData.set("currentPath", nodeId ? currentPath : "");
					formData.set("storageNodeId", targetNode);
					formData.set("folderName", name.trim());
					try {
						const result = await createFolderAction(null, formData);
						if (result?.error) {
							setError(result.error);
							return;
						}
						addToast("success", result?.success ?? t("filesPage.drive.folderCreated", { name: name.trim() }));
						onClose();
						onCreated();
					} catch (cause) {
						setError(cause instanceof Error ? cause.message : t("filePreferences.failed"));
					} finally {
						setBusy(false);
					}
				}}
			>
				{!nodeId ? (
					<FormField label={t("common.targetNode")} htmlFor={`${formId}-node`}>
						<select id={`${formId}-node`} className={UI_INPUT} value={targetNode} disabled={busy}
							onChange={(event) => setTargetNode(event.currentTarget.value)}>
							{writable.map((node) => (
								<option key={node.id} value={node.id}>
									{node.name}{node.teamName ? ` · ${node.teamName}` : ""} ({getStorageDriverLabel(t, node.driver)})
								</option>
							))}
						</select>
					</FormField>
				) : null}
				<FormField label={t("common.folderName")} htmlFor={`${formId}-name`} error={error || (name ? (reason ? t(`filesPage.drive.nameError.${reason}`) : "") : "")}>
					<input
						ref={inputRef}
						id={`${formId}-name`}
						className={UI_INPUT}
						value={name}
						maxLength={255}
						disabled={busy}
						autoComplete="off"
						placeholder={t("common.folderNamePlaceholder")}
						onChange={(event) => setName(event.currentTarget.value)}
					/>
				</FormField>
				{!writable.length ? <Notice tone="warning">{t("filesBrowserSpa.cannotCreateFolderNoNode")}</Notice> : null}
			</form>
		</Dialog>
	);
}

export function ViewToggle() {
	const { t } = useI18n();
	const [viewMode, setViewMode] = useViewMode();
	return (
		<SegmentedControl
			ariaLabel={t("fileListClient.viewMode")}
			size="sm"
			compactLabels
			value={viewMode === "grid" ? "grid" : "list"}
			onChange={setViewMode}
			options={[
				{ value: "list", label: t("filesPage.list.viewList"), ariaLabel: t("fileListClient.listView"), title: t("fileListClient.listView"), icon: <ListIcon aria-hidden /> },
				{ value: "grid", label: t("filesPage.list.viewGrid"), ariaLabel: t("fileListClient.iconView"), title: t("fileListClient.iconView"), icon: <IconLayoutGrid aria-hidden /> },
			]}
		/>
	);
}

const SORT_KEYS: FileListSortKey[] = ["name", "updated", "size", "source"];

export function SortMenu({ sortKey, sortDir, onChange, showSource }: {
	sortKey: FileListSortKey;
	sortDir: FileListSortDir;
	onChange: (key: FileListSortKey, dir: FileListSortDir) => void;
	showSource: boolean;
}) {
	const { t } = useI18n();
	const label = (key: FileListSortKey) => t(key === "name" ? "fileListClient.name" : key === "updated" ? "fileListClient.modified" : key === "size" ? "fileListClient.size" : "fileListClient.source");
	return (
		<Menu
			label={t("filesPage.drive.sort")}
			trigger={<><ArrowDownUp size={15} aria-hidden /><span className="max-sm:sr-only">{label(sortKey)}</span></>}
			size="sm"
			variant="ghost"
			align="end"
			panelClassName="w-44"
		>
			{SORT_KEYS.filter((key) => key !== "source" || showSource).map((key) => (
				<MenuItem key={key} onSelect={() => onChange(key, sortDir)} hint={key === sortKey ? "✓" : undefined}>{label(key)}</MenuItem>
			))}
			<MenuSeparator />
			<MenuItem onSelect={() => onChange(sortKey, "asc")} hint={sortDir === "asc" ? "✓" : undefined}>{t("filesPage.drive.ascending")}</MenuItem>
			<MenuItem onSelect={() => onChange(sortKey, "desc")} hint={sortDir === "desc" ? "✓" : undefined}>{t("filesPage.drive.descending")}</MenuItem>
		</Menu>
	);
}
