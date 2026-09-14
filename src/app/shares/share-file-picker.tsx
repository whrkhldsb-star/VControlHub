"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Copy, File, Folder, Loader2, RefreshCw, Share2 } from "@/components/icons";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState } from "@/components/page-shell";
import { Pagination } from "@/components/pagination";
import { useI18n } from "@/lib/i18n/use-locale";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";

import { ActionButton } from "@/components/action-button";
import { getErrorMessage } from "@/lib/http/error-message";
interface StorageNode {
	id: string;
	name: string;
	driver?: string;
}

interface FileListFolder {
	name: string;
	path?: string;
	relativePath?: string;
	storageNodeId?: string | null;
	storageNodeName?: string | null;
	childrenCount?: number;
	filesCount?: number;
}

interface FileListFile {
	id: string;
	name: string;
	entryType: string;
	relativePath: string;
	sizeLabel?: string | null;
	storageNodeId: string;
	storageNodeName?: string | null;
	storageNodeDriver?: string | null;
}

interface FileListResponse {
	pagination?: {page:number;pageSize:number;totalItems:number;totalPages:number};
	currentPath: string;
	nodeIdFilter: string;
	folders: FileListFolder[];
	files: FileListFile[];
	nodes: StorageNode[];
	syncWarning?: string | null;
	permissions?: { canShare?: boolean };
}

type SelectedEntry = {
	key: string;
	name: string;
	path: string;
	storageNodeId: string;
	entryType: "FILE" | "DIRECTORY";
	sizeLabel?: string | null;
};

type CreatedShare = {
	key: string;
	name: string;
	url: string;
};

function normalizePath(path: string) {
	return path.replace(/^\/+|\/+$/g, "");
}

function folderPath(folder: FileListFolder) {
	return normalizePath(folder.relativePath || folder.path || folder.name);
}

function entryKey(input: { storageNodeId: string; path: string; entryType: string }) {
	return `${input.entryType}:${input.storageNodeId}:${normalizePath(input.path)}`;
}

function buildFileListParams(nodeId: string, path: string) {
	const params = new URLSearchParams({ nodeId });
	if (path) params.set("path", path);
	return params;
}

export function ShareFilePicker({ nodes }: { nodes: StorageNode[] }) {
	const router = useRouter();
	const { t } = useI18n();
	const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "");
	const [path, setPath] = useState("");
	const [page, setPage] = useState(1);
	const [data, setData] = useState<FileListResponse | null>(() => nodes[0]?.id ? { currentPath: "", nodeIdFilter: nodes[0].id, folders: [], files: [], nodes } : null);
	const [selected, setSelected] = useState<Record<string, SelectedEntry>>({});
	const [loading, setLoading] = useState(false);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState("");
	const [results, setResults] = useState<CreatedShare[]>([]);
	const [copiedKey, setCopiedKey] = useState("");
	const requestRef = useRef<AbortController | null>(null);
	const creatingRef = useRef(false);
	const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const selectedItems = useMemo(() => Object.values(selected), [selected]);
	const breadcrumb = useMemo(() => path.split("/").filter(Boolean), [path]);
	const copyText = {
		eyebrow: t("sharesPage.picker.eyebrow"),
		title: t("sharesPage.picker.title"),
		description: t("sharesPage.picker.description"),
		refresh: t("sharesPage.picker.refresh"),
		root: t("sharesPage.picker.root"),
		name: t("sharesPage.picker.name"),
		type: t("sharesPage.picker.type"),
		size: t("sharesPage.picker.size"),
		loading: t("sharesPage.picker.loading"),
		empty: t("sharesPage.picker.noItems"),
		folder: t("sharesPage.picker.folder"),
		file: t("sharesPage.picker.file"),
		selectFolder: t("sharesPage.picker.selectFolder"),
		selectFile: t("sharesPage.picker.selectFile"),
		selectedPrefix: t("sharesPage.picker.selectedPrefix"),
		selectedSuffix: t("sharesPage.picker.selectedSuffix"),
		selectedHint: t("sharesPage.picker.selectedHint"),
		clear: t("sharesPage.picker.clear"),
		selectedEmpty: t("sharesPage.picker.selectedEmpty"),
		creating: t("sharesPage.picker.creating"),
		create: t("sharesPage.picker.create"),
		created: t("sharesPage.picker.created"),
		copy: t("sharesPage.picker.copy"),
		copied: t("sharesPage.picker.copied"),
		loadError: t("sharesPage.picker.loadError"),
		createError: t("sharesPage.picker.createError"),
	};

	const loadFiles = useCallback(async (refresh = false) => {
		if (!nodeId) return;
		requestRef.current?.abort();
		const controller = new AbortController();
		requestRef.current = controller;
		setLoading(true);
		setError("");
		try {
			const params = buildFileListParams(nodeId, path);
			if (page > 1) {
				params.set("page",String(page));
				if (!refresh) params.set("sync","0");
			}
			const response = await csrfFetch<FileListResponse>(`/api/files/list?${params.toString()}`, { signal: controller.signal });
			if (requestRef.current !== controller) return;
			setData(response);
		} catch (err) {
			if (requestRef.current !== controller) return;
			setError(getErrorMessage(err, copyText.loadError));
		} finally {
			if (requestRef.current === controller) setLoading(false);
		}
	}, [copyText.loadError, nodeId, path, page]);

	useEffect(() => {
		// The request lifecycle owns loading state for both navigation and refresh.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void loadFiles();
		return () => {
			requestRef.current?.abort();
			requestRef.current = null;
		};
	}, [loadFiles]);

	useEffect(() => () => {
		if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
	}, []);

	const toggleSelection = (entry: SelectedEntry) => {
		setSelected((current) => {
			const next = { ...current };
			if (next[entry.key]) {
				delete next[entry.key];
			} else {
				next[entry.key] = entry;
			}
			return next;
		});
	};

	const openFolder = (folder: FileListFolder) => {
		setPage(1);
		setPath(folderPath(folder));
		setResults([]);
	};

	const jumpToCrumb = (index: number) => {
		setPage(1);
		setPath(breadcrumb.slice(0, index + 1).join("/"));
		setResults([]);
	};

	const createShares = async () => {
		if (selectedItems.length === 0 || creatingRef.current) return;
		creatingRef.current = true;
		setCreating(true);
		setError("");
		let createdCount = 0;
		try {
			for (const item of selectedItems) {
				const result = await csrfFetch<{ token: string }>("/api/share-links", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						storageNodeId: item.storageNodeId,
						path: item.path,
						entryType: item.entryType,
						name: item.name,
					}),
				});
				const created = {
					key: item.key,
					name: item.name,
					url: `${window.location.origin}/share/${result.token}`,
				};
				// Keep completed links visible and retry only the unfinished items.
				setResults((current) => [...current.filter((entry) => entry.key !== item.key), created]);
				setSelected((current) => {
					const next = { ...current };
					delete next[item.key];
					return next;
				});
				createdCount += 1;
			}
		} catch (err) {
			setError(getErrorMessage(err, copyText.createError));
		} finally {
			if (createdCount > 0) router.refresh();
			creatingRef.current = false;
			setCreating(false);
		}
	};

	const copy = async (item: CreatedShare) => {
		try {
			await navigator.clipboard.writeText(item.url);
			setCopiedKey(item.key);
			if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
			copyTimerRef.current = setTimeout(() => setCopiedKey(""), 1600);
		} catch {
			setCopiedKey("");
			setError(t("sharesPage.picker.copyError"));
		}
	};

	return (
		<section data-i18n-skip className="min-w-0 border-t border-[var(--border)] py-5">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase  text-[var(--color-action)]">{copyText.eyebrow}</p>
					<h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{copyText.title}</h2>
					<p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
						{copyText.description}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<label className="sr-only" htmlFor="shareFilePickerNode">{t("sharesPage.picker.storageNodeLabel")}</label>
					<select
						id="shareFilePickerNode"
						value={nodeId}
						disabled={creating}
						onChange={(event) => {
							setNodeId(event.target.value);
							setPage(1);
							setPath("");
							setSelected({});
							setResults([]);
						}}
						className="min-w-0 max-w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
					>
						{nodes.map((node) => (
							<option key={node.id} value={node.id}>{node.name}{node.driver ? ` · ${getStorageDriverLabel(t, node.driver)}` : ""}</option>
						))}
					</select>
					<ActionButton variant="secondary"
						onClick={() => void loadFiles(true)}
					
						className="!min-h-11 !inline-flex !items-center !gap-2 !px-3 !py-2 !text-sm"
					>
						<RefreshCw size={15} className={loading ? "animate-spin" : ""} /> {copyText.refresh}
					</ActionButton>
				</div>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
				<ActionButton variant="ghost" disabled={creating} onClick={() => { setPath("");setPage(1); }} className="!min-h-11 !px-2.5 !py-1 !text-sm">{copyText.root}</ActionButton>
				{breadcrumb.map((segment, index) => (
					<span key={`${segment}-${index}`} className="inline-flex items-center gap-2">
						<ChevronRight size={12} />
						<ActionButton variant="ghost" disabled={creating} onClick={() => jumpToCrumb(index)} className="!min-h-11 !px-2.5 !py-1 !text-sm">{segment}</ActionButton>
					</span>
				))}
			</div>

			{error ? <p data-tone="rose" className="mt-3 rounded-xl border border-[var(--danger-border)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
			{data?.syncWarning ? <p data-tone="amber" className="mt-3 rounded-xl border border-[var(--warning-border)] px-3 py-2 text-sm text-[var(--warning)]">{data.syncWarning}</p> : null}

			<div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<div className="min-w-0 border-y border-[var(--border)]">
					<div className="grid grid-cols-[2rem_minmax(0,1fr)_4.5rem] gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-medium uppercase  text-[var(--text-muted)] sm:grid-cols-[2rem_minmax(0,1fr)_5rem_6rem]">
						<span />
						<span>{copyText.name}</span>
						<span className="hidden sm:block">{copyText.type}</span>
						<span>{copyText.size}</span>
					</div>
					{loading ? (
						<div className="flex items-center justify-center gap-2 p-8 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> {copyText.loading}</div>
					) : (data?.folders.length || data?.files.length) ? (
						<div className="divide-y divide-white/[0.10] light:divide-[var(--border)]">
							{data?.folders.map((folder) => {
								const item: SelectedEntry = {
									key: entryKey({ storageNodeId: folder.storageNodeId || nodeId, path: folderPath(folder), entryType: "DIRECTORY" }),
									name: folder.name,
									path: folderPath(folder),
									storageNodeId: folder.storageNodeId || nodeId,
									entryType: "DIRECTORY",
								};
								return (
									<div key={item.key} className="grid grid-cols-[2rem_minmax(0,1fr)_4.5rem] items-center gap-2 px-3 py-2.5 text-sm hover:bg-[var(--surface)] light:hover:bg-[var(--surface)] sm:grid-cols-[2rem_minmax(0,1fr)_5rem_6rem]">
										<input type="checkbox" disabled={creating} checked={Boolean(selected[item.key])} aria-label={`${copyText.selectFolder} ${folder.name}`} onChange={() => toggleSelection(item)} className="h-4 w-4 accent-[var(--color-action)]" />
										<ActionButton variant="ghost" disabled={creating} onClick={() => openFolder(folder)} className="!min-h-11 !flex !min-w-0 !items-center !gap-2 !justify-start !px-2 !text-left !text-sm">
											<Folder size={17} className="shrink-0 text-[var(--color-action)]" />
											<span className="truncate">{folder.name}</span>
										</ActionButton>
										<span className="hidden text-xs text-[var(--text-muted)] sm:block">{copyText.folder}</span>
										<span className="text-xs text-[var(--text-muted)]">—</span>
									</div>
								);
							})}
							{data?.files.map((file) => {
								const item: SelectedEntry = {
									key: entryKey({ storageNodeId: file.storageNodeId, path: file.relativePath, entryType: "FILE" }),
									name: file.name,
									path: normalizePath(file.relativePath),
									storageNodeId: file.storageNodeId,
									entryType: "FILE",
									sizeLabel: file.sizeLabel,
								};
								return (
									<label key={item.key} className="grid grid-cols-[2rem_minmax(0,1fr)_4.5rem] items-center gap-2 px-3 py-2.5 text-sm hover:bg-[var(--surface)] light:hover:bg-[var(--surface)] sm:grid-cols-[2rem_minmax(0,1fr)_5rem_6rem]">
										<input type="checkbox" disabled={creating} checked={Boolean(selected[item.key])} aria-label={`${copyText.selectFile} ${file.name}`} onChange={() => toggleSelection(item)} className="h-4 w-4 accent-[var(--color-action)]" />
										<span className="flex min-w-0 items-center gap-2 text-[var(--text-primary)]"><File size={16} className="shrink-0 text-[var(--text-secondary)]" /><span className="truncate">{file.name}</span></span>
										<span className="hidden text-xs text-[var(--text-muted)] sm:block">{copyText.file}</span>
										<span className="truncate text-xs text-[var(--text-muted)]">{file.sizeLabel ?? "—"}</span>
									</label>
								);
							})}
						</div>
					) : (
						<EmptyState text={copyText.empty} />
					)}
					{data?.pagination ? <Pagination page={data.pagination.page} pageSize={data.pagination.pageSize} totalItems={data.pagination.totalItems} loading={loading || creating} onPageChange={setPage} /> : null}
				</div>

				<aside className="min-w-0 border-t border-[var(--border)] pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h3 className="text-sm font-semibold text-[var(--text-primary)]">{copyText.selectedPrefix} {selectedItems.length} {copyText.selectedSuffix}</h3>
							<p className="mt-1 text-xs text-[var(--text-muted)]">{copyText.selectedHint}</p>
						</div>
						<ActionButton variant="ghost" disabled={creating} onClick={() => setSelected({})} className="!min-h-11 shrink-0 whitespace-nowrap !px-2 !text-sm">{copyText.clear}</ActionButton>
					</div>
					<div className="mt-3 max-h-48 space-y-2 overflow-auto pr-1">
						{selectedItems.length ? selectedItems.map((item) => (
							<div key={item.key} className="rounded-lg border border-[var(--border)]/[0.07] bg-[var(--surface)] px-3 py-2 text-xs">
								<div className="truncate font-medium text-[var(--text-primary)]">{item.name}</div>
								<div className="mt-0.5 truncate text-[var(--text-muted)]">{item.entryType === "DIRECTORY" ? copyText.folder : copyText.file} · {item.path}</div>
							</div>
						)) : <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">{copyText.selectedEmpty}</p>}
					</div>
					<ActionButton
						type="button"
						onClick={() => void createShares()}
						disabled={creating || selectedItems.length === 0}
						className="mt-4 min-h-11 w-full gap-2 text-sm"
					>
						{creating ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
						{creating ? copyText.creating : copyText.create}
					</ActionButton>

					{results.length ? (
						<div className="mt-4 space-y-2">
							<p className="text-xs font-medium text-[var(--success)]">{copyText.created}</p>
							{results.map((item) => (
								<div key={item.key} className="rounded-lg border border-[var(--success-border)] bg-[var(--success-bg)] p-2 text-xs">
									<div className="truncate text-[var(--success)]">{item.name}</div>
									<div className="mt-1 flex items-center gap-2">
										<code className="min-w-0 flex-1 truncate text-[var(--success)]/80">{item.url}</code>
										<ActionButton variant="success" onClick={() => void copy(item)} className="!min-h-9 !inline-flex !items-center !gap-1 !px-2 !py-1 !text-sm"><Copy size={12} />{copiedKey === item.key ? copyText.copied : copyText.copy}</ActionButton>
									</div>
								</div>
							))}
						</div>
					) : null}
				</aside>
			</div>
		</section>
	);
}
