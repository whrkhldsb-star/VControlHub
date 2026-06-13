"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Copy, File, Folder, Loader2, RefreshCw, Share2 } from "lucide-react";

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
	const { locale } = useI18n();
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
	const copyText = locale === "zh" ? {
		eyebrow: "Share Center",
		title: "在分享中心选择文件",
		description: "像文件管理一样浏览目录，勾选文件或文件夹后批量创建分享链接，不需要跳转到文件管理页。",
		refresh: "刷新当前目录",
		root: "根目录",
		name: "名称",
		type: "类型",
		size: "大小",
		loading: "加载中…",
		empty: "当前目录没有可分享条目",
		folder: "文件夹",
		file: "文件",
		selectFolder: "选择文件夹",
		selectFile: "选择文件",
		selectedPrefix: "已选择",
		selectedSuffix: "项",
		selectedHint: "文件和文件夹会分别生成独立分享链接。",
		clear: "清空",
		selectedEmpty: "勾选左侧文件或文件夹",
		creating: "创建中…",
		create: "创建分享链接",
		created: "已创建，可直接复制：",
		copy: "复制",
		copied: "已复制",
		loadError: "加载文件列表失败",
		createError: "创建分享失败",
	} : {
		eyebrow: "Share Center",
		title: "Choose files in Shares",
		description: "Browse storage like the file manager, select files or folders, and create share links without leaving this page.",
		refresh: "Refresh current folder",
		root: "Root",
		name: "Name",
		type: "Type",
		size: "Size",
		loading: "Loading…",
		empty: "No shareable items in this folder",
		folder: "Folder",
		file: "File",
		selectFolder: "Select folder",
		selectFile: "Select file",
		selectedPrefix: "Selected",
		selectedSuffix: "items",
		selectedHint: "Files and folders create separate share links.",
		clear: "Clear",
		selectedEmpty: "Select files or folders on the left",
		creating: "Creating…",
		create: "Create share links",
		created: "Created. Copy directly:",
		copy: "Copy",
		copied: "Copied",
		loadError: "Failed to load file list",
		createError: "Failed to create shares",
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
		<section data-i18n-skip className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_18px_60px_rgba(2,6,23,0.22)] light:shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">{copyText.eyebrow}</p>
					<h2 className="mt-1 text-xl font-semibold text-white">{copyText.title}</h2>
					<p className="mt-1 max-w-2xl text-sm text-slate-500">
						{copyText.description}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<select
						value={nodeId}
						onChange={(event) => {
							setNodeId(event.target.value);
							setPath("");
							setSelected({});
							setResults([]);
						}}
						className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none"
					>
						{nodes.map((node) => (
							<option key={node.id} value={node.id}>{node.name}{node.driver ? ` · ${node.driver}` : ""}</option>
						))}
					</select>
					<button
						type="button"
						onClick={() => void loadFiles()}
						className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 light:hover:bg-slate-50"
					>
						<RefreshCw size={15} className={loading ? "animate-spin" : ""} /> {copyText.refresh}
					</button>
				</div>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
				<button type="button" onClick={() => setPath("")} className="rounded-full border border-white/10 px-2.5 py-1 hover:text-cyan-200 light:hover:text-cyan-700">{copyText.root}</button>
				{breadcrumb.map((segment, index) => (
					<span key={`${segment}-${index}`} className="inline-flex items-center gap-2">
						<ChevronRight size={12} />
						<button type="button" onClick={() => jumpToCrumb(index)} className="rounded-full border border-white/10 px-2.5 py-1 hover:text-cyan-200 light:hover:text-cyan-700">{segment}</button>
					</span>
				))}
			</div>

			{error ? <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p> : null}
			{data?.syncWarning ? <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{data.syncWarning}</p> : null}

			<div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<div className="overflow-hidden rounded-xl border border-white/[0.08]">
					<div className="grid grid-cols-[2rem_minmax(0,1fr)_8rem_6rem] gap-2 border-b border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
						<span />
						<span>{copyText.name}</span>
						<span>{copyText.type}</span>
						<span>{copyText.size}</span>
					</div>
					{loading ? (
						<div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> {copyText.loading}</div>
					) : (data?.folders.length || data?.files.length) ? (
						<div className="divide-y divide-white/[0.06] light:divide-slate-200">
							{data?.folders.map((folder) => {
								const item: SelectedEntry = {
									key: entryKey({ storageNodeId: folder.storageNodeId || nodeId, path: folderPath(folder), entryType: "DIRECTORY" }),
									name: folder.name,
									path: folderPath(folder),
									storageNodeId: folder.storageNodeId || nodeId,
									entryType: "DIRECTORY",
								};
								return (
									<div key={item.key} className="grid grid-cols-[2rem_minmax(0,1fr)_8rem_6rem] items-center gap-2 px-3 py-2.5 text-sm hover:bg-white/[0.04] light:hover:bg-slate-50">
										<input type="checkbox" checked={Boolean(selected[item.key])} onChange={() => toggleSelection(item)} className="h-4 w-4 accent-cyan-500" aria-label={`${copyText.selectFolder} ${folder.name}`} />
										<button type="button" onClick={() => openFolder(folder)} className="flex min-w-0 items-center gap-2 text-left text-slate-200 hover:text-cyan-200 light:hover:text-cyan-700">
											<Folder size={17} className="shrink-0 text-cyan-300" />
											<span className="truncate">{folder.name}</span>
										</button>
										<span className="text-xs text-slate-500">{copyText.folder}</span>
										<span className="text-xs text-slate-600">—</span>
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
									<label key={item.key} className="grid grid-cols-[2rem_minmax(0,1fr)_8rem_6rem] items-center gap-2 px-3 py-2.5 text-sm hover:bg-white/[0.04] light:hover:bg-slate-50">
										<input type="checkbox" checked={Boolean(selected[item.key])} onChange={() => toggleSelection(item)} className="h-4 w-4 accent-cyan-500" aria-label={`${copyText.selectFile} ${file.name}`} />
										<span className="flex min-w-0 items-center gap-2 text-slate-200"><File size={16} className="shrink-0 text-slate-400" /><span className="truncate">{file.name}</span></span>
										<span className="text-xs text-slate-500">{copyText.file}</span>
										<span className="truncate text-xs text-slate-500">{file.sizeLabel ?? "—"}</span>
									</label>
								);
							})}
						</div>
					) : (
						<EmptyState text={copyText.empty} />
					)}
				</div>

				<aside className="rounded-xl border border-white/[0.08] bg-slate-950/35 p-4">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h3 className="text-sm font-semibold text-white">{copyText.selectedPrefix} {selectedItems.length} {copyText.selectedSuffix}</h3>
							<p className="mt-1 text-xs text-slate-500">{copyText.selectedHint}</p>
						</div>
						<button type="button" onClick={() => setSelected({})} className="text-xs text-slate-500 hover:text-slate-200 light:hover:text-slate-700">{copyText.clear}</button>
					</div>
					<div className="mt-3 max-h-48 space-y-2 overflow-auto pr-1">
						{selectedItems.length ? selectedItems.map((item) => (
							<div key={item.key} className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs">
								<div className="truncate font-medium text-slate-200">{item.name}</div>
								<div className="mt-0.5 truncate text-slate-500">{item.entryType === "DIRECTORY" ? copyText.folder : copyText.file} · {item.path}</div>
							</div>
						)) : <p className="rounded-lg border border-dashed border-white/[0.08] p-4 text-center text-xs text-slate-500">{copyText.selectedEmpty}</p>}
					</div>
					<button
						type="button"
						onClick={() => void createShares()}
						disabled={creating || selectedItems.length === 0}
						className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
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
										<button type="button" onClick={() => void copy(item)} className="inline-flex items-center gap-1 rounded-md border border-emerald-400/30 px-2 py-1 text-emerald-100"><Copy size={12} />{copiedKey === item.key ? copyText.copied : copyText.copy}</button>
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
