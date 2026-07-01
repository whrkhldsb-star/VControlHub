"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Copy, File, Folder, Loader2, RefreshCw, Share2 } from "@/components/icons";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

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

export function ShareFilePicker({ nodes }: { nodes: StorageNode[] }) {
	const router = useRouter();
	const { t } = useI18n();
	const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "");
	const [path, setPath] = useState("");
	const [data, setData] = useState<FileListResponse | null>(() => nodes[0]?.id ? { currentPath: "", nodeIdFilter: nodes[0].id, folders: [], files: [], nodes } : null);
	const [selected, setSelected] = useState<Record<string, SelectedEntry>>({});
	const [loading, setLoading] = useState(false);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState("");
	const [results, setResults] = useState<CreatedShare[]>([]);
	const [copiedKey, setCopiedKey] = useState("");

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

	const loadFiles = useCallback(async () => {
		if (!nodeId) return;
		setLoading(true);
		setError("");
		try {
			const params = new URLSearchParams({ nodeId, path });
			const response = await csrfFetch<FileListResponse>(`/api/files/list?${params.toString()}`);
			setData(response);
		} catch (err) {
			setError(err instanceof Error ? err.message : copyText.loadError);
		} finally {
			setLoading(false);
		}
	}, [copyText.loadError, nodeId, path]);

	useEffect(() => {
		if (!nodeId) return;
		let active = true;
		const params = new URLSearchParams({ nodeId, path });
		void csrfFetch<FileListResponse>(`/api/files/list?${params.toString()}`)
			.then((response) => {
				if (active) setData(response);
			})
			.catch((err) => {
				if (active) setError(err instanceof Error ? err.message : copyText.loadError);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [copyText.loadError, nodeId, path]);

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
		setPath(folderPath(folder));
		setResults([]);
	};

	const jumpToCrumb = (index: number) => {
		setPath(breadcrumb.slice(0, index + 1).join("/"));
		setResults([]);
	};

	const createShares = async () => {
		if (selectedItems.length === 0) return;
		setCreating(true);
		setError("");
		setResults([]);
		try {
			const created: CreatedShare[] = [];
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
				created.push({
					key: item.key,
					name: item.name,
					url: `${window.location.origin}/share/${result.token}`,
				});
			}
			setResults(created);
			setSelected({});
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : copyText.createError);
		} finally {
			setCreating(false);
		}
	};

	const copy = async (item: CreatedShare) => {
		await navigator.clipboard?.writeText(item.url).catch(() => undefined);
		setCopiedKey(item.key);
		setTimeout(() => setCopiedKey(""), 1600);
	};

	return (
		<section data-i18n-skip className="rounded-2xl border border-[var(--border)]/[0.10] bg-[var(--surface)]/[0.04] p-4 shadow-[0_18px_60px_rgba(2,6,23,0.22)] light:shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">{copyText.eyebrow}</p>
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
						onChange={(event) => {
							setNodeId(event.target.value);
							setPath("");
							setSelected({});
							setResults([]);
						}}
						className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
					>
						{nodes.map((node) => (
							<option key={node.id} value={node.id}>{node.name}{node.driver ? ` · ${node.driver}` : ""}</option>
						))}
					</select>
					<button
						type="button"
						onClick={() => void loadFiles()}
						className="min-h-11 inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
					>
						<RefreshCw size={15} className={loading ? "animate-spin" : ""} /> {copyText.refresh}
					</button>
				</div>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
				<button type="button" onClick={() => setPath("")} className="min-h-11 min-w-11 rounded-full border border-[var(--border)]/10 px-2.5 py-1 hover:text-[var(--text-secondary)] light:hover:text-cyan-700">{copyText.root}</button>
				{breadcrumb.map((segment, index) => (
					<span key={`${segment}-${index}`} className="inline-flex items-center gap-2">
						<ChevronRight size={12} />
						<button type="button" onClick={() => jumpToCrumb(index)} className="min-h-11 min-w-11 rounded-full border border-[var(--border)]/10 px-2.5 py-1 hover:text-[var(--text-secondary)] light:hover:text-cyan-700">{segment}</button>
					</span>
				))}
			</div>

			{error ? <p data-tone="rose" className="mt-3 rounded-xl border border-rose-400/20 px-3 py-2 text-sm text-rose-300">{error}</p> : null}
			{data?.syncWarning ? <p data-tone="amber" className="mt-3 rounded-xl border border-amber-400/20 px-3 py-2 text-sm text-amber-200">{data.syncWarning}</p> : null}

			<div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<div className="overflow-hidden rounded-xl border border-[var(--border)]/[0.10]">
					<div className="grid grid-cols-[2rem_minmax(0,1fr)_8rem_6rem] gap-2 border-b border-[var(--border)]/[0.10] bg-[var(--surface)]/[0.04] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
						<span />
						<span>{copyText.name}</span>
						<span>{copyText.type}</span>
						<span>{copyText.size}</span>
					</div>
					{loading ? (
						<div className="flex items-center justify-center gap-2 p-8 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> {copyText.loading}</div>
					) : (data?.folders.length || data?.files.length) ? (
						<div className="divide-y divide-white/[0.10] light:divide-slate-200">
							{data?.folders.map((folder) => {
								const item: SelectedEntry = {
									key: entryKey({ storageNodeId: folder.storageNodeId || nodeId, path: folderPath(folder), entryType: "DIRECTORY" }),
									name: folder.name,
									path: folderPath(folder),
									storageNodeId: folder.storageNodeId || nodeId,
									entryType: "DIRECTORY",
								};
								return (
									<div key={item.key} className="grid grid-cols-[2rem_minmax(0,1fr)_8rem_6rem] items-center gap-2 px-3 py-2.5 text-sm hover:bg-[var(--surface)]/[0.04] light:hover:bg-slate-50">
										<input type="checkbox" checked={Boolean(selected[item.key])} onChange={() => toggleSelection(item)} className="h-4 w-4 accent-cyan-500" aria-label={`${copyText.selectFolder} ${folder.name}`} />
										<button type="button" onClick={() => openFolder(folder)} className="min-h-11 flex min-w-0 items-center gap-2 text-left text-[var(--text-primary)] hover:text-[var(--text-secondary)] light:hover:text-cyan-700">
											<Folder size={17} className="shrink-0 text-cyan-300" />
											<span className="truncate">{folder.name}</span>
										</button>
										<span className="text-xs text-[var(--text-muted)]">{copyText.folder}</span>
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
									<label key={item.key} className="grid grid-cols-[2rem_minmax(0,1fr)_8rem_6rem] items-center gap-2 px-3 py-2.5 text-sm hover:bg-[var(--surface)]/[0.04] light:hover:bg-slate-50">
										<input type="checkbox" checked={Boolean(selected[item.key])} onChange={() => toggleSelection(item)} className="h-4 w-4 accent-cyan-500" aria-label={`${copyText.selectFile} ${file.name}`} />
										<span className="flex min-w-0 items-center gap-2 text-[var(--text-primary)]"><File size={16} className="shrink-0 text-[var(--text-secondary)]" /><span className="truncate">{file.name}</span></span>
										<span className="text-xs text-[var(--text-muted)]">{copyText.file}</span>
										<span className="truncate text-xs text-[var(--text-muted)]">{file.sizeLabel ?? "—"}</span>
									</label>
								);
							})}
						</div>
					) : (
						<EmptyState text={copyText.empty} />
					)}
				</div>

				<aside className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h3 className="text-sm font-semibold text-[var(--text-primary)]">{copyText.selectedPrefix} {selectedItems.length} {copyText.selectedSuffix}</h3>
							<p className="mt-1 text-xs text-[var(--text-muted)]">{copyText.selectedHint}</p>
						</div>
						<button type="button" onClick={() => setSelected({})} className="min-h-11 min-w-11 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] light:hover:text-slate-700">{copyText.clear}</button>
					</div>
					<div className="mt-3 max-h-48 space-y-2 overflow-auto pr-1">
						{selectedItems.length ? selectedItems.map((item) => (
							<div key={item.key} className="rounded-lg border border-[var(--border)]/[0.07] bg-[var(--surface)]/[0.04] px-3 py-2 text-xs">
								<div className="truncate font-medium text-[var(--text-primary)]">{item.name}</div>
								<div className="mt-0.5 truncate text-[var(--text-muted)]">{item.entryType === "DIRECTORY" ? copyText.folder : copyText.file} · {item.path}</div>
							</div>
						)) : <p className="rounded-lg border border-dashed border-[var(--border)]/[0.10] p-4 text-center text-xs text-[var(--text-muted)]">{copyText.selectedEmpty}</p>}
					</div>
					<button
						type="button"
						onClick={() => void createShares()}
						disabled={creating || selectedItems.length === 0}
						className="min-h-11 mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{creating ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
						{creating ? copyText.creating : copyText.create}
					</button>

					{results.length ? (
						<div className="mt-4 space-y-2">
							<p className="text-xs font-medium text-emerald-300">{copyText.created}</p>
							{results.map((item) => (
								<div key={item.key} className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] p-2 text-xs">
									<div className="truncate text-emerald-100">{item.name}</div>
									<div className="mt-1 flex items-center gap-2">
										<code className="min-w-0 flex-1 truncate text-emerald-200/80">{item.url}</code>
										<button type="button" onClick={() => void copy(item)} className="min-h-11 min-w-11 inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 px-2 py-1 text-emerald-100"><Copy size={12} />{copiedKey === item.key ? copyText.copied : copyText.copy}</button>
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
