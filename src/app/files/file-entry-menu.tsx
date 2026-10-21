"use client";

/**
 * The actions of one file or folder, as menu items. The row's "more" button
 * and the right-click menu render the same list, so a capability gate or a
 * new action changes both. Dialogs open through `useFileActions`.
 */
import { Fragment, useRef, useState, type ReactNode } from "react";

import { Copy, Download, Eye, FolderInput, FolderOpen, Info, LinkIcon, Pencil, Star, Tag, Trash2 } from "@/components/icons";
import { IconMore } from "@/components/nav-icons";
import { AnchoredMenu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { useI18n } from "@/lib/i18n/use-locale";
import type { FileProp } from "./file-entry-utils";
import { recordFileOpen } from "./file-preferences-client";
import type { FileActionTarget } from "./file-actions";
import { useFileActions } from "./file-actions";
import type { FolderProp } from "./file-list-model";

/** The action target of an indexed folder; null for a node root or an unindexed folder. */
export function folderActionTarget(folder: FolderProp): FileActionTarget | null {
	const nodeId = folder.storageNodeId ?? (folder.sourceKeys.length === 1 ? folder.sourceKeys[0] : undefined);
	if (!folder.entryId || !nodeId) return null;
	return {
		id: folder.entryId,
		name: folder.displayName ?? folder.name,
		entryType: "DIRECTORY",
		relativePath: folder.relativePath ?? folder.path,
		storageNodeId: nodeId,
		storageNodeName: folder.sourceValues[0],
		favorite: folder.favorite,
	};
}

export function fileActionTarget(file: FileProp): FileActionTarget {
	return {
		id: file.id,
		name: file.name,
		entryType: "FILE",
		relativePath: file.relativePath,
		storageNodeId: file.storageNodeId,
		storageNodeName: file.storageNodeName,
		favorite: file.favorite,
	};
}

/** Save a file through a plain anchor, so API routes are never prefetched as pages. */
export function triggerDownload(href: string) {
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.download = "";
	anchor.rel = "noopener";
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
}

export type EntryMenuModel = {
	kind: "file" | "folder";
	/** Absent for a node root or an unindexed folder: only "open" applies. */
	target: FileActionTarget | null;
	canRead: boolean;
	canWrite: boolean;
	canDelete: boolean;
	canShare: boolean;
	/** "Preview" when the browser can show the file, otherwise none (details stay). */
	openLabel?: string;
	/** What opening does when it is not a plain preview (Office notice, archive listing). */
	openDescription?: string;
	onOpen?: () => void;
	downloadHref?: string | null;
	onDetails?: () => void;
};

export function EntryMenuItems({ model }: { model: EntryMenuModel }) {
	const { t } = useI18n();
	const actions = useFileActions();
	const { target, canRead, canWrite, canDelete } = model;
	const groups: ReactNode[][] = [[], [], [], []];
	if (model.onOpen && model.openLabel) {
		groups[0]!.push(
			<MenuItem key="open" icon={model.kind === "folder" ? <FolderOpen aria-hidden /> : <Eye aria-hidden />} description={model.openDescription} onSelect={model.onOpen}>
				{model.openLabel}
			</MenuItem>,
		);
	}
	if (canRead && model.downloadHref) {
		const href = model.downloadHref;
		groups[0]!.push(
			<MenuItem key="download" icon={<Download aria-hidden />} onSelect={() => {
				if (target) recordFileOpen(target.id);
				triggerDownload(href);
			}}>
				{model.kind === "folder" ? t("fileListClient.downloadFolderArchiveTitle") : t("fileListClient.downloadTitle")}
			</MenuItem>,
		);
	}
	if (target && model.kind === "file" && canRead && model.canShare) {
		groups[0]!.push(
			<MenuItem key="share" icon={<LinkIcon aria-hidden />} onSelect={() => actions.share(target)}>
				{t("sharesPage.button.compact")}
			</MenuItem>,
		);
	}
	if (model.onDetails) {
		groups[0]!.push(
			<MenuItem key="details" icon={<Info aria-hidden />} onSelect={model.onDetails}>
				{t("fileListClient.detailTitle")}
			</MenuItem>,
		);
	}
	if (target && canRead) {
		groups[1]!.push(
			<MenuItem key="favorite" icon={<Star aria-hidden fill={target.favorite ? "currentColor" : "none"} />} onSelect={() => void actions.toggleFavorite(target)}>
				{t(target.favorite ? "filesPage.drive.unfavorite" : "filesPage.drive.favorite")}
			</MenuItem>,
			<MenuItem key="tags" icon={<Tag aria-hidden />} onSelect={() => actions.editTags(target)}>
				{t("filesPage.drive.editTags")}
			</MenuItem>,
		);
	}
	if (target && canWrite) {
		groups[2]!.push(
			<MenuItem key="rename" icon={<Pencil aria-hidden />} onSelect={() => actions.rename(target)}>
				{t("renameInlineForm.rename")}
			</MenuItem>,
			<MenuItem key="move" icon={<FolderInput aria-hidden />} onSelect={() => actions.move([target])}>
				{t("filesPage.drive.moveToEllipsis")}
			</MenuItem>,
		);
		if (canRead) {
			groups[2]!.push(
				<MenuItem key="copy" icon={<Copy aria-hidden />} onSelect={() => actions.copy([target])}>
					{t("filesPage.drive.copyToEllipsis")}
				</MenuItem>,
			);
		}
	}
	if (target && canDelete) {
		groups[3]!.push(
			<MenuItem key="delete" danger icon={<Trash2 aria-hidden />} onSelect={() => actions.remove([target])}>
				{t("common.delete")}
			</MenuItem>,
		);
	}
	const visible = groups.filter((group) => group.length > 0);
	return (
		<>
			{visible.map((group, index) => (
				<Fragment key={index}>
					{index > 0 ? <MenuSeparator /> : null}
					{group}
				</Fragment>
			))}
		</>
	);
}

/** True when the menu would list anything beyond "open". */
export function entryMenuHasActions(model: EntryMenuModel) {
	return Boolean(
		(model.canRead && model.downloadHref)
		|| model.onDetails
		|| (model.target && (model.canRead || model.canWrite || model.canDelete)),
	);
}

/** The row's "more" button. */
export function EntryMoreButton({ model, label, className }: { model: EntryMenuModel; label: string; className?: string }) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	if (!entryMenuHasActions(model)) return null;
	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				aria-label={label}
				title={label}
				aria-haspopup="menu"
				aria-expanded={anchor !== null}
				data-action-button=""
				data-variant="ghost"
				data-size="sm"
				data-square=""
				className={className}
				onClick={(event) => {
					event.stopPropagation();
					setAnchor((current) => (current ? null : buttonRef.current));
				}}
			>
				<IconMore size={16} aria-hidden />
			</button>
			<AnchoredMenu anchor={anchor} label={label} onClose={() => setAnchor(null)}>
				<EntryMenuItems model={model} />
			</AnchoredMenu>
		</>
	);
}
