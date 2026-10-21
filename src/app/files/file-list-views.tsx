"use client";

/**
 * List and grid layouts of the drive. Both render the same `DriveRow`s that
 * FileListClient prepares (names, labels, capability gates, handlers), so the
 * two views can never disagree about what an entry allows.
 *
 * - Click the name to open (folder, preview, image viewer or details).
 * - Click elsewhere on a row to select it; Ctrl/⌘ adds, Shift extends.
 * - Double-click opens; right-click opens the same menu as the ⋯ button.
 */
import Link from "next/link";
import { useState, type MouseEvent, type ReactNode } from "react";

import { Download, Globe, HardDrive, LinkIcon, Server, Star } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/ui/cn";
import { FileTypeIcon } from "./file-entry-icons";
import { EntryMoreButton, triggerDownload, type EntryMenuModel } from "./file-entry-menu";
import type { FileListSortDir, FileListSortKey } from "./file-list-model";

export type DriveRow = {
	key: string;
	kind: "folder" | "file";
	/** File entry id (selection, drag and drop); null for node roots and unindexed folders. */
	id: string | null;
	name: string;
	/** Muted second line: the folder in search results, the node in mixed listings. */
	detail?: string;
	sizeLabel: string;
	modifiedLabel: string;
	/** Date only, where space is short (grid tiles). */
	modifiedDay?: string;
	sourceLabel?: string;
	favorite: boolean;
	icon: { entryType: string; mimeType?: string | null; name: string };
	/** A storage node shown as an entry (the all-locations root). */
	nodeDriver?: string;
	thumbUrl: string | null;
	/** A real URL for the name (new tab, copy link); clicks still go through `onOpen`. */
	openHref: string | null;
	onOpen: () => void;
	selectable: boolean;
	selected: boolean;
	draggable: boolean;
	/** Folders that accept dropped entries. */
	dropPath?: string;
	nodeId?: string;
	menu: EntryMenuModel;
	/** Hover shortcuts on desktop rows. */
	downloadHref?: string | null;
	onShare?: () => void;
};

export type DriveRowHandlers = {
	onToggle: (row: DriveRow) => void;
	onRowClick: (row: DriveRow, event: MouseEvent) => void;
	onContextMenu: (row: DriveRow, event: MouseEvent) => void;
};

const INTERACTIVE = "a,button,input,label,select,textarea,[role=menuitem]";

function isInteractive(event: MouseEvent) {
	return Boolean((event.target as HTMLElement).closest(INTERACTIVE));
}

/** Thumbnail when the server can make one, otherwise the type icon (also after a failed load). */
export function EntryThumb({ row, size, cover = false, fit }: {
	row: DriveRow;
	size: number;
	cover?: boolean;
	/** "contain": natural size, never enlarged (the details drawer). */
	fit?: "contain";
}) {
	const [failed, setFailed] = useState(false);
	if (row.thumbUrl && !failed) {
		return (
			// eslint-disable-next-line @next/next/no-img-element
			<img
				src={row.thumbUrl}
				alt=""
				loading="lazy"
				decoding="async"
				draggable={false}
				onError={() => setFailed(true)}
				className={fit === "contain"
					? "max-h-full max-w-full rounded-[calc(var(--radius-control)-2px)] object-contain"
					: cover ? "h-full w-full object-cover" : "h-full w-full rounded-[calc(var(--radius-control)-2px)] object-cover"}
				data-testid="file-thumbnail"
			/>
		);
	}
	if (row.nodeDriver) {
		const Icon = row.nodeDriver === "SFTP" ? Server : row.nodeDriver === "WEBDAV" ? Globe : HardDrive;
		return (
			<span className="grid place-items-center rounded-[var(--radius-card)] bg-[var(--accent-bg)] text-[var(--accent)]" style={{ width: Math.round(size * 1.1), height: Math.round(size * 1.1) }} aria-hidden="true">
				<Icon size={Math.round(size * 0.55)} />
			</span>
		);
	}
	// Line icons read at about three quarters of a thumbnail's box.
	return <FileTypeIcon entry={row.icon} size={Math.round(size * 0.72)} />;
}

function EntryName({ row, className }: { row: DriveRow; className?: string }) {
	const onClick = (event: MouseEvent) => {
		// Let the browser handle new-tab and download gestures on real links.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
		event.preventDefault();
		row.onOpen();
	};
	const classes = cn("min-w-0 truncate text-left font-medium text-[var(--text-primary)] hover:text-[var(--accent)] focus-visible:text-[var(--accent)]", className);
	return row.openHref ? (
		<Link href={row.openHref} prefetch={false} onClick={onClick} className={classes} title={row.name} draggable={false}>
			{row.name}
		</Link>
	) : (
		<button type="button" onClick={() => row.onOpen()} className={classes} title={row.name}>
			{row.name}
		</button>
	);
}

function SelectBox({ row, onToggle, className }: { row: DriveRow; onToggle: (row: DriveRow) => void; className?: string }) {
	const { t } = useI18n();
	if (!row.selectable || !row.id) return <span className={cn("block h-4 w-4", className)} aria-hidden="true" />;
	return (
		<input
			type="checkbox"
			checked={row.selected}
			aria-label={t("fileListClient.selectFileAria", { name: row.name })}
			onChange={() => onToggle(row)}
			className={cn("h-4 w-4 cursor-pointer accent-[var(--color-action)]", className)}
		/>
	);
}

function QuickActions({ row }: { row: DriveRow }) {
	const { t } = useI18n();
	return (
		<div className="flex shrink-0 items-center justify-end gap-0.5">
			<div className="hidden items-center gap-0.5 md:flex pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
				{row.onShare ? (
					<button type="button" aria-label={`${t("sharesPage.button.compact")} ${row.name}`} title={t("sharesPage.button.compact")}
						data-action-button="" data-variant="ghost" data-size="sm" data-square="" onClick={row.onShare}>
						<LinkIcon size={15} aria-hidden />
					</button>
				) : null}
				{row.downloadHref ? (
					<button type="button" aria-label={`${t("fileListClient.downloadTitle")} ${row.name}`} title={t("fileListClient.downloadTitle")}
						data-action-button="" data-variant="ghost" data-size="sm" data-square="" onClick={() => triggerDownload(row.downloadHref!)}>
						<Download size={15} aria-hidden />
					</button>
				) : null}
			</div>
			<EntryMoreButton model={row.menu} label={t("fileMoreActions.more") + " " + row.name} />
		</div>
	);
}

/** "1.2 MB · 2026/10/20 14:31" — the parts a row knows, skipping placeholders. */
function entryMeta(row: DriveRow, short = false) {
	return [row.sizeLabel, short ? (row.modifiedDay ?? row.modifiedLabel) : row.modifiedLabel].filter((part) => part && part !== "—").join(" · ");
}

function rowDataAttributes(row: DriveRow) {
	return {
		"data-file-entry-id": row.id ?? undefined,
		"data-file-drop-path": row.dropPath,
		"data-file-node-id": row.nodeId,
		"data-file-kind": row.kind,
		"data-selected": row.selected ? "" : undefined,
	};
}

function SortHeader({ column, label, sortKey, sortDir, onSort, className }: {
	column: FileListSortKey;
	label: string;
	sortKey: FileListSortKey;
	sortDir: FileListSortDir;
	onSort: (key: FileListSortKey) => void;
	className?: string;
}) {
	const { t } = useI18n();
	const active = column === sortKey;
	return (
		<button
			type="button"
			onClick={() => onSort(column)}
			aria-label={t("fileListClient.sortByAria", { label })}
			aria-pressed={active}
			data-sort-direction={active ? sortDir : undefined}
			className={cn("inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:text-[var(--text-primary)]", active && "text-[var(--text-primary)]", className)}
		>
			<span className="truncate">{label}</span>
			<span aria-hidden="true" className={cn("text-[10px]", !active && "opacity-0")}>{sortDir === "asc" || !active ? "▲" : "▼"}</span>
		</button>
	);
}

// Every row is its own grid, so each column has a fixed width from md up;
// an `auto` column sized per row would let the rows drift out of line.
const LIST_COLUMNS = "grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[2rem_minmax(0,1fr)_8.5rem_5.5rem_6.5rem]";
const LIST_COLUMNS_WITH_SOURCE = "grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[2rem_minmax(0,1fr)_8.5rem_5.5rem_6.5rem] xl:grid-cols-[2rem_minmax(0,1fr)_9rem_8.5rem_5.5rem_6.5rem]";

export function FileListView({ rows, handlers, empty, showSource, header }: {
	rows: DriveRow[];
	handlers: DriveRowHandlers;
	empty: ReactNode;
	showSource: boolean;
	header: {
		allSelected: boolean;
		someSelected: boolean;
		selectableCount: number;
		onToggleAll: () => void;
		sortKey: FileListSortKey;
		sortDir: FileListSortDir;
		onSort: (key: FileListSortKey) => void;
		/** Replaces the column headers while entries are selected. */
		selectionBar?: ReactNode;
	};
}) {
	const { t } = useI18n();
	const columns = showSource ? LIST_COLUMNS_WITH_SOURCE : LIST_COLUMNS;
	return (
		<div data-testid="file-table" className="min-w-0">
			{/* Same header strip as the app's tables (globals.css, Tables). */}
			<div className={cn("sticky top-0 z-10 grid min-h-10 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-4 text-[length:var(--font-label)] font-medium text-[var(--text-muted)] sm:px-5", columns)}>
				<input
					type="checkbox"
					checked={header.allSelected}
					aria-label={t("fileListClient.selectAllFiles")}
					ref={(element) => {
						if (element) element.indeterminate = header.someSelected;
					}}
					onChange={header.onToggleAll}
					disabled={header.selectableCount === 0}
					className="h-4 w-4 cursor-pointer accent-[var(--color-action)] disabled:cursor-not-allowed"
				/>
				{header.selectionBar ? (
					<div className="col-span-2 min-w-0 md:col-span-3 xl:col-span-4">{header.selectionBar}</div>
				) : (
					<>
						<SortHeader column="name" label={t("fileListClient.name")} {...sortProps(header)} className="-ml-1" />
						{/* Hidden columns hide on a wrapper: `hidden` and `inline-flex` on one element conflict in Tailwind 4. */}
						{showSource ? <span className="hidden min-w-0 xl:block"><SortHeader column="source" label={t("fileListClient.source")} {...sortProps(header)} /></span> : null}
						<span className="hidden min-w-0 md:block"><SortHeader column="updated" label={t("fileListClient.modified")} {...sortProps(header)} /></span>
						<span className="hidden min-w-0 md:block"><SortHeader column="size" label={t("fileListClient.size")} {...sortProps(header)} /></span>
						<span className="sr-only">{t("fileListClient.actions")}</span>
					</>
				)}
			</div>
			{rows.length === 0 ? empty : (
				<ul className="divide-y divide-[var(--border-subtle)]">
					{rows.map((row) => (
						<li
							key={row.key}
							{...rowDataAttributes(row)}
							draggable={row.draggable}
							onClick={(event) => {
								if (!isInteractive(event)) handlers.onRowClick(row, event);
							}}
							onDoubleClick={(event) => {
								if (!isInteractive(event)) row.onOpen();
							}}
							onContextMenu={(event) => handlers.onContextMenu(row, event)}
							className={cn(
								"group grid min-h-14 items-center gap-3 px-4 py-1.5 text-sm transition-colors sm:px-5",
								columns,
								row.selected ? "bg-[var(--accent-bg)]" : "hover:bg-[var(--surface-hover)]",
							)}
						>
							<SelectBox row={row} onToggle={handlers.onToggle} />
							<div className="flex min-w-0 items-center gap-3">
								<span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden">
									<EntryThumb row={row} size={32} />
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 items-center gap-1.5">
										<EntryName row={row} />
										{row.favorite ? <Star size={13} fill="currentColor" className="shrink-0 text-[var(--chart-3)]" aria-label={t("filePreferences.favorite")} /> : null}
									</div>
									{row.detail ? <p className="truncate text-xs text-[var(--text-muted)]" title={row.detail}>{row.detail}</p> : null}
									<p className="truncate text-xs text-[var(--text-muted)] md:hidden">
										{entryMeta(row) || (row.kind === "folder" ? t("fileListClient.directory") : "")}
									</p>
								</div>
							</div>
							{showSource ? <span className="hidden truncate text-xs text-[var(--text-secondary)] xl:block" title={row.sourceLabel}>{row.sourceLabel}</span> : null}
							<span className="hidden text-xs tabular-nums text-[var(--text-secondary)] md:block">{row.modifiedLabel}</span>
							<span className="hidden text-xs tabular-nums text-[var(--text-secondary)] md:block">{row.sizeLabel}</span>
							<QuickActions row={row} />
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function sortProps(header: { sortKey: FileListSortKey; sortDir: FileListSortDir; onSort: (key: FileListSortKey) => void }) {
	return { sortKey: header.sortKey, sortDir: header.sortDir, onSort: header.onSort };
}

export function FileGridView({ rows, handlers, empty, selectionBar }: {
	rows: DriveRow[];
	handlers: DriveRowHandlers;
	empty: ReactNode;
	selectionBar?: ReactNode;
}) {
	const { t } = useI18n();
	return (
		<div className="min-w-0">
			{selectionBar ? (
				<div className="sticky top-0 z-10 flex min-h-10 items-center border-b border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-4 sm:px-5">{selectionBar}</div>
			) : null}
			{rows.length === 0 ? empty : (
				<ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 p-4 sm:p-5">
					{rows.map((row) => (
						<li
							key={row.key}
							{...rowDataAttributes(row)}
							data-testid={row.kind === "folder" ? "folder-card" : "file-card"}
							draggable={row.draggable}
							onClick={(event) => {
								if (!isInteractive(event)) handlers.onRowClick(row, event);
							}}
							onDoubleClick={(event) => {
								if (!isInteractive(event)) row.onOpen();
							}}
							onContextMenu={(event) => handlers.onContextMenu(row, event)}
							data-tile=""
							className="group relative flex min-w-0 cursor-pointer flex-col overflow-hidden transition-[border-color,box-shadow] hover:shadow-[var(--shadow-sm)]"
						>
							<div className={cn("grid aspect-[4/3] place-items-center overflow-hidden", row.thumbUrl ? "bg-[var(--surface-subtle)]" : "bg-[color-mix(in_srgb,var(--surface-subtle)_70%,transparent)]")}>
								<EntryThumb row={row} size={row.kind === "folder" ? 64 : 56} cover />
							</div>
							<div className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 pb-2.5 pt-2">
								<div className="flex min-w-0 items-center gap-1">
									<EntryName row={row} className="text-[13px]" />
									{row.favorite ? <Star size={12} fill="currentColor" className="shrink-0 text-[var(--chart-3)]" aria-label={t("filePreferences.favorite")} /> : null}
								</div>
								<p className="truncate text-xs text-[var(--text-muted)]">
									{entryMeta(row, true) || (row.kind === "folder" ? t("fileListClient.directory") : "—")}
								</p>
							</div>
							<SelectBox
								row={row}
								onToggle={handlers.onToggle}
								className={cn(
									"absolute left-2.5 top-2.5 shadow-[var(--shadow-xs)]",
									!row.selected && "pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100",
								)}
							/>
							<div className={cn(
								"absolute right-1.5 top-1.5 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] backdrop-blur",
								"pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
							)}>
								<EntryMoreButton model={row.menu} label={t("fileMoreActions.more") + " " + row.name} />
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
