"use client";

/**
 * File actions for the drive: one provider owns every dialog (rename, move,
 * copy, delete, share, tags) so a row's menu, its context menu, the details
 * drawer and the selection bar all open the same dialog through
 * `useFileActions().run(...)`. A dialog outlives the menu that opened it.
 *
 * Single entries rename, move and delete through the server actions and
 * report back at once; several entries (and every copy) go to the background
 * file-operation queue, whose progress the operations panel shows.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Copy, LinkIcon } from "@/components/icons";
import { useToast } from "@/components/toast-provider";
import { Dialog } from "@/components/ui/dialog";
import { CheckboxField, FormField, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { QUICK_SHARE_DEFAULT_EXPIRY_HOURS } from "@/lib/share-link/policy";
import { UI_INPUT } from "@/lib/ui/classes";
import { deleteFileEntryAction, renameFileEntryAction } from "../storage/actions";
import { containingFolderPath } from "./file-entry-utils";
import { FolderBrowser } from "./folder-destination-picker";
import { moveFileAction } from "./move-file-action";
import { submitFileOperation } from "./file-operation-controls";

/** An indexed entry an action can work on. */
export type FileActionTarget = {
	id: string;
	name: string;
	entryType: "FILE" | "DIRECTORY";
	/** Path inside its storage node. */
	relativePath: string;
	storageNodeId: string;
	storageNodeName?: string;
	favorite?: boolean;
};

type PendingAction =
	| { kind: "rename"; target: FileActionTarget }
	| { kind: "move" | "copy" | "delete"; targets: FileActionTarget[] }
	| { kind: "share" | "tags"; target: FileActionTarget };

type FileActionsApi = {
	rename: (target: FileActionTarget) => void;
	move: (targets: FileActionTarget[]) => void;
	copy: (targets: FileActionTarget[]) => void;
	remove: (targets: FileActionTarget[]) => void;
	share: (target: FileActionTarget) => void;
	editTags: (target: FileActionTarget) => void;
	toggleFavorite: (target: FileActionTarget) => Promise<void>;
	/** Unpack a ZIP/tar archive on a LOCAL node into a new folder beside it. */
	extract: (target: FileActionTarget) => Promise<void>;
};

const FileActionsContext = createContext<FileActionsApi | null>(null);

export function useFileActions(): FileActionsApi {
	const api = useContext(FileActionsContext);
	if (!api) throw new Error("useFileActions must be used inside FileActionsProvider");
	return api;
}

/** Names the server accepts (path-utils `normalizeStorageEntryName`): spaces are fine. */
const INVALID_NAME_CHARS = /[\u0000-\u001f\u007f\\/:*?"<>|]/;

export function validateEntryName(name: string): "required" | "invalidChars" | "dots" | "tooLong" | null {
	const value = name.trim();
	if (!value) return "required";
	if (value === "." || value === "..") return "dots";
	if (INVALID_NAME_CHARS.test(value)) return "invalidChars";
	if (value.length > 255) return "tooLong";
	return null;
}

export function FileActionsProvider({ children, onChanged, onCleared }: {
	children: ReactNode;
	/** Refresh the listing after a change finished. */
	onChanged?: () => void;
	/** Clear the selection after a batch action was accepted. */
	onCleared?: () => void;
}) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const [pending, setPending] = useState<PendingAction | null>(null);
	const latest = useRef({ onChanged, onCleared });
	useEffect(() => {
		latest.current = { onChanged, onCleared };
	}, [onChanged, onCleared]);
	const close = useCallback(() => setPending(null), []);
	const changed = useCallback(() => latest.current.onChanged?.(), []);
	const cleared = useCallback(() => latest.current.onCleared?.(), []);

	const toggleFavorite = useCallback(async (target: FileActionTarget) => {
		try {
			await csrfFetch("/api/files/preferences", {
				method: "PATCH",
				body: JSON.stringify({ fileEntryId: target.id, favorite: !target.favorite }),
			});
			addToast("success", t(target.favorite ? "filesPage.drive.unfavorited" : "filesPage.drive.favorited", { name: target.name }));
			window.dispatchEvent(new Event("file-preferences-changed"));
			changed();
		} catch (error) {
			addToast("error", getErrorMessage(error, t("filePreferences.failed")));
		}
	}, [addToast, changed, t]);

	const extract = useCallback(async (target: FileActionTarget) => {
		addToast("info", t("filesPage.drive.extracting", { name: target.name }));
		try {
			const data = await csrfFetch("/api/files/extract", {
				method: "POST",
				body: JSON.stringify({ nodeId: target.storageNodeId, relativePath: target.relativePath, driver: "LOCAL", name: target.name }),
			});
			if (data.error) throw new Error(data.error);
			addToast("success", data.message || t("archivePreview.extractDone"));
			changed();
		} catch (error) {
			addToast("error", getErrorMessage(error, t("archivePreview.extractFailed")));
		}
	}, [addToast, changed, t]);

	const api = useMemo<FileActionsApi>(() => ({
		rename: (target) => setPending({ kind: "rename", target }),
		move: (targets) => setPending({ kind: "move", targets }),
		copy: (targets) => setPending({ kind: "copy", targets }),
		remove: (targets) => setPending({ kind: "delete", targets }),
		share: (target) => setPending({ kind: "share", target }),
		editTags: (target) => setPending({ kind: "tags", target }),
		toggleFavorite,
		extract,
	}), [extract, toggleFavorite]);

	return (
		<FileActionsContext.Provider value={api}>
			{children}
			{pending?.kind === "rename" ? <RenameDialog key={pending.target.id} target={pending.target} onClose={close} onDone={changed} /> : null}
			{pending?.kind === "move" || pending?.kind === "copy" ? (
				<TransferDialog key={pending.kind} mode={pending.kind} targets={pending.targets} onClose={close} onDone={changed} onQueued={cleared} />
			) : null}
			{pending?.kind === "delete" ? <DeleteDialog targets={pending.targets} onClose={close} onDone={changed} onQueued={cleared} /> : null}
			{pending?.kind === "share" ? <ShareDialog target={pending.target} onClose={close} /> : null}
			{pending?.kind === "tags" ? <TagsDialog target={pending.target} onClose={close} onDone={changed} /> : null}
		</FileActionsContext.Provider>
	);
}

function nameErrorText(t: (key: string, vars?: Record<string, string | number>) => string, reason: ReturnType<typeof validateEntryName>) {
	return reason ? t(`filesPage.drive.nameError.${reason}`) : "";
}

function RenameDialog({ target, onClose, onDone }: { target: FileActionTarget; onClose: () => void; onDone: () => void }) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const formId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState(target.name);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const reason = validateEntryName(name);
	const unchanged = name.trim() === target.name;

	// Select the base name, as desktop file managers do, so typing keeps the extension.
	useEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		const dot = target.entryType === "FILE" ? target.name.lastIndexOf(".") : -1;
		input.focus();
		input.setSelectionRange(0, dot > 0 ? dot : target.name.length);
	}, [target]);

	return (
		<Dialog
			open
			onClose={onClose}
			busy={busy}
			title={t("renameInlineForm.rename")}
			description={<span className="break-all">{target.name}</span>}
			initialFocusRef={inputRef}
			footer={<>
				<ActionButton variant="secondary" disabled={busy} onClick={onClose}>{t("common.cancel")}</ActionButton>
				<ActionButton type="submit" form={formId} loading={busy} disabled={Boolean(reason) || unchanged}>{t("renameInlineForm.confirm")}</ActionButton>
			</>}
		>
			<form
				id={formId}
				noValidate
				onSubmit={async (event) => {
					event.preventDefault();
					if (busy || reason || unchanged) return;
					setBusy(true);
					setError("");
					const formData = new FormData();
					formData.set("fileEntryId", target.id);
					formData.set("newName", name.trim());
					try {
						const result = await renameFileEntryAction(null, formData);
						if (result?.error) {
							setError(result.error);
							return;
						}
						addToast("success", result?.success ?? t("filesPage.drive.renamed"));
						onClose();
						onDone();
					} catch (cause) {
						setError(getErrorMessage(cause, t("filePreferences.failed")));
					} finally {
						setBusy(false);
					}
				}}
			>
				<FormField label={t("renameInlineForm.newName")} htmlFor={`${formId}-name`} error={error || (name ? nameErrorText(t, reason) : "")}>
					<input
						ref={inputRef}
						id={`${formId}-name`}
						className={UI_INPUT}
						value={name}
						maxLength={255}
						disabled={busy}
						autoComplete="off"
						spellCheck={false}
						onChange={(event) => setName(event.currentTarget.value)}
					/>
				</FormField>
			</form>
		</Dialog>
	);
}

function TransferDialog({ mode, targets, onClose, onDone, onQueued }: {
	mode: "move" | "copy";
	targets: FileActionTarget[];
	onClose: () => void;
	onDone: () => void;
	onQueued: () => void;
}) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const first = targets[0]!;
	const sourceFolders = useMemo(() => new Set(targets.map((target) => containingFolderPath(target.relativePath))), [targets]);
	const [path, setPath] = useState(() => (sourceFolders.size === 1 ? [...sourceFolders][0]! : ""));
	const [ready, setReady] = useState(false);
	const [policy, setPolicy] = useState<"rename" | "skip" | "overwrite">("rename");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const attempt = useRef<{ key: string; id: string } | null>(null);
	const policyId = useId();
	const movedFolders = useMemo(() => new Set(targets.filter((target) => target.entryType === "DIRECTORY").map((target) => target.relativePath)), [targets]);
	// Moving into the folder the items already sit in, or into a moved folder, is a no-op or a loop.
	const sameFolder = mode === "move" && sourceFolders.size === 1 && sourceFolders.has(path);
	const insideMoved = [...movedFolders].some((folder) => path === folder || path.startsWith(`${folder}/`));
	const label = targets.length === 1 ? first.name : t("filesPage.drive.itemCount", { count: targets.length });

	async function submit() {
		if (busy || !ready || sameFolder || insideMoved) return;
		setBusy(true);
		setError("");
		const targetDir = path || ".";
		try {
			if (mode === "move" && targets.length === 1) {
				const formData = new FormData();
				formData.set("fileEntryId", first.id);
				formData.set("targetDir", targetDir);
				formData.set("currentRelativePath", first.relativePath);
				formData.set("storageNodeId", first.storageNodeId);
				const result = await moveFileAction(null, formData);
				if (result?.error) {
					setError(result.error);
					if (result.needsReconcile) onDone();
					return;
				}
				addToast("success", result?.success ?? t("filesPage.drive.moved", { name: first.name }));
				onClose();
				onDone();
				return;
			}
			const ids = targets.map((target) => target.id);
			const key = JSON.stringify([mode, ids, targetDir, policy]);
			if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
			await submitFileOperation({ action: mode, fileEntryIds: ids, targetDir, policy: mode === "move" ? "skip" : policy }, attempt.current.id);
			attempt.current = null;
			addToast("info", t("fileOperations.queued"));
			onClose();
			onQueued();
		} catch (cause) {
			setError(getErrorMessage(cause, t("filePreferences.failed")));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			open
			size="lg"
			onClose={onClose}
			busy={busy}
			title={t(mode === "move" ? "filesPage.drive.moveTo" : "filesPage.drive.copyTo")}
			description={<span className="break-all">{label}</span>}
			footer={<>
				<ActionButton variant="secondary" disabled={busy} onClick={onClose}>{t("common.cancel")}</ActionButton>
				<ActionButton loading={busy} disabled={!ready || sameFolder || insideMoved} onClick={() => void submit()}>
					{t(mode === "move" ? "filesPage.drive.moveHere" : "filesPage.drive.copyHere")}
				</ActionButton>
			</>}
		>
			<div className="flex flex-col gap-4">
				<FolderBrowser
					nodeId={first.storageNodeId}
					nodeName={first.storageNodeName}
					path={path}
					onPathChange={setPath}
					disabledPaths={mode === "move" ? movedFolders : undefined}
					onReadyChange={setReady}
				/>
				{sameFolder ? <p className="text-xs text-[var(--text-muted)]">{t("filesPage.drive.sameFolderHint")}</p> : null}
				{insideMoved ? <p className="text-xs text-[var(--warning)]">{t("filesPage.drive.insideMovedHint")}</p> : null}
				{mode === "copy" ? (
					<FormField label={t("fileOperations.conflict")} htmlFor={policyId}>
						<select id={policyId} className={UI_INPUT} value={policy} disabled={busy}
							onChange={(event) => setPolicy(event.currentTarget.value as typeof policy)}>
							{(["rename", "skip", "overwrite"] as const).map((value) => (
								<option key={value} value={value}>{t(`fileOperations.${value}`)}</option>
							))}
						</select>
					</FormField>
				) : null}
				{mode === "copy" && policy === "overwrite" ? <Notice tone="warning">{t("fileOperations.overwriteNotice")}</Notice> : null}
				{error ? <Notice tone="danger">{error}</Notice> : null}
			</div>
		</Dialog>
	);
}

function DeleteDialog({ targets, onClose, onDone, onQueued }: {
	targets: FileActionTarget[];
	onClose: () => void;
	onDone: () => void;
	onQueued: () => void;
}) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const attempt = useRef<string | null>(null);
	const first = targets[0]!;
	const description = targets.length === 1
		? t("filesPage.actions.confirmDelete", {
			name: first.name,
			contents: first.entryType === "DIRECTORY" ? t("filesPage.actions.directoryContents") : "",
		})
		: t("filesPage.drive.confirmDeleteMany", { count: targets.length });

	async function confirm() {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			if (targets.length === 1) {
				const formData = new FormData();
				formData.set("fileEntryId", first.id);
				const result = await deleteFileEntryAction(null, formData);
				if (result?.error) {
					setError(result.error);
					return;
				}
				addToast("success", result?.success ?? t("filesPage.drive.deleted", { name: first.name }));
				onClose();
				onDone();
				return;
			}
			attempt.current ??= crypto.randomUUID();
			await submitFileOperation({ action: "delete", fileEntryIds: targets.map((target) => target.id), targetDir: ".", policy: "skip" }, attempt.current);
			addToast("info", t("fileOperations.queued"));
			onClose();
			onQueued();
		} catch (cause) {
			setError(getErrorMessage(cause, t("filePreferences.failed")));
		} finally {
			setBusy(false);
		}
	}

	return (
		<ConfirmDialog
			open
			title={t("common.delete")}
			description={description}
			cancelLabel={t("common.cancel")}
			confirmLabel={t("common.confirm")}
			onCancel={onClose}
			onConfirm={() => void confirm()}
			busy={busy}
			error={error || undefined}
		/>
	);
}

function ShareDialog({ target, onClose }: { target: FileActionTarget; onClose: () => void }) {
	const { t } = useI18n();
	const [busy, setBusy] = useState(false);
	const [url, setUrl] = useState("");
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState("");

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	async function create() {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			const data = await csrfFetch<{ token: string }>("/api/share-links", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ fileEntryId: target.id, quick: true }),
			});
			const link = `${window.location.origin}/share/${data.token}`;
			setUrl(link);
			await copy(link);
		} catch (cause) {
			setError(getErrorMessage(cause, t("sharesPage.button.errorFallback")));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			open
			onClose={onClose}
			busy={busy}
			title={t("sharesPage.button.quickConfirmTitle")}
			description={<span className="break-all">{target.name}</span>}
			footer={url ? (
				<ActionButton onClick={onClose}>{t("filesPage.drive.done")}</ActionButton>
			) : <>
				<ActionButton variant="secondary" disabled={busy} onClick={onClose}>{t("sharesPage.button.quickConfirmCancel")}</ActionButton>
				<ActionButton loading={busy} icon={<LinkIcon aria-hidden />} onClick={() => void create()}>{t("sharesPage.button.quickConfirmAction")}</ActionButton>
			</>}
		>
			{url ? (
				<div className="flex flex-col gap-3">
					<p className="text-sm text-[var(--success)]">{t(copied ? "sharesPage.button.generatedAndCopied" : "sharesPage.button.generated")}</p>
					<div className="flex min-w-0 items-center gap-2">
						<code className="min-w-0 flex-1 break-all rounded-[var(--radius-control)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">{url}</code>
						<ActionButton variant="secondary" icon={<Copy aria-hidden />} onClick={() => void copy(url)}>
							{t(copied ? "sharesPage.button.copied" : "sharesPage.button.copy")}
						</ActionButton>
					</div>
					<p className="text-xs text-[var(--text-muted)]">
						{t("filesPage.drive.shareManageHint")}{" "}
						<Link href="/shares" className="text-[var(--accent)] hover:underline">{t("filesPage.drive.shareManageLink")}</Link>
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					<p className="text-sm text-[var(--text-secondary)]">{t("sharesPage.button.quickConfirmDescription", { hours: QUICK_SHARE_DEFAULT_EXPIRY_HOURS })}</p>
					{error ? <Notice tone="danger">{error}</Notice> : null}
				</div>
			)}
		</Dialog>
	);
}

type PreferencePage = { items: Array<{ favorite: boolean; tags: string[] }> };

function TagsDialog({ target, onClose, onDone }: { target: FileActionTarget; onClose: () => void; onDone: () => void }) {
	const { t } = useI18n();
	const formId = useId();
	const [favorite, setFavorite] = useState(Boolean(target.favorite));
	const [tags, setTags] = useState("");
	const [loaded, setLoaded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [reload, setReload] = useState(0);

	useEffect(() => {
		const controller = new AbortController();
		void csrfFetch<PreferencePage>("/api/files/preferences", { params: { mode: "entry", fileEntryId: target.id }, signal: controller.signal })
			.then((page) => {
				setFavorite(page.items[0]?.favorite ?? false);
				setTags(page.items[0]?.tags.join(", ") ?? "");
				setLoaded(true);
				setError("");
			})
			.catch((cause: unknown) => {
				if (!controller.signal.aborted) setError(getErrorMessage(cause, t("filePreferences.failed")));
			});
		return () => controller.abort();
	}, [target.id, reload, t]);

	return (
		<Dialog
			open
			onClose={onClose}
			busy={busy}
			title={t("filePreferences.edit")}
			description={<span className="break-all">{target.name}</span>}
			footer={<>
				<ActionButton variant="secondary" disabled={busy} onClick={onClose}>{t("common.cancel")}</ActionButton>
				<ActionButton type="submit" form={formId} loading={busy} disabled={!loaded}>{t("common.save")}</ActionButton>
			</>}
		>
			{error ? (
				<Notice tone="danger" className="mb-4" action={{ label: t("storageUpload.retry"), onClick: () => setReload((value) => value + 1) }}>{error}</Notice>
			) : null}
			<form
				id={formId}
				className="grid gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					if (busy || !loaded) return;
					setBusy(true);
					setError("");
					try {
						await csrfFetch("/api/files/preferences", {
							method: "PATCH",
							body: JSON.stringify({
								fileEntryId: target.id,
								favorite,
								tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
							}),
						});
						window.dispatchEvent(new Event("file-preferences-changed"));
						onClose();
						onDone();
					} catch (cause) {
						setError(getErrorMessage(cause, t("filePreferences.failed")));
					} finally {
						setBusy(false);
					}
				}}
			>
				<CheckboxField label={t("filePreferences.favorite")} checked={favorite} disabled={busy || !loaded}
					onChange={(event) => setFavorite(event.currentTarget.checked)} />
				<FormField label={t("filePreferences.tags")} htmlFor={`${formId}-tags`} hint={t("filesPage.drive.tagsHint")}>
					<input
						id={`${formId}-tags`}
						className={UI_INPUT}
						value={tags}
						disabled={busy || !loaded}
						maxLength={406}
						placeholder={t("filePreferences.tagsPlaceholder")}
						onChange={(event) => setTags(event.currentTarget.value)}
					/>
				</FormField>
			</form>
		</Dialog>
	);
}
