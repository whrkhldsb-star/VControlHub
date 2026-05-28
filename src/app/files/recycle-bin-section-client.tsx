"use client";

import { RestoreButton } from "./restore-button";
import { PermanentDeleteButton } from "./permanent-delete-button";

export type DeletedEntryProp = {
	id: string;
	name: string;
	entryType: string;
	relativePath: string;
	size: number | bigint | null;
};

function formatFileSize(bytes: number | bigint | null | undefined): string {
	if (bytes == null) return "-";
	const size = typeof bytes === "bigint" ? Number(bytes) : bytes;
	if (!Number.isFinite(size) || size < 0) return "-";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function RecycleBinSectionClient({
	deletedEntries,
	canDelete,
	onRefresh,
}: {
	deletedEntries: DeletedEntryProp[];
	canDelete: boolean;
	onRefresh?: () => void;
}) {
	if (deletedEntries.length === 0) {
		return (
			<article className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
				<h3 className="text-xl font-semibold text-white">🗑️ 回收站</h3>
				<p className="mt-4 text-sm text-slate-400">回收站为空，没有已删除的文件。</p>
			</article>
		);
	}

	return (
		<article className="rounded-3xl border border-rose-400/20 bg-slate-900/60 p-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h3 className="text-xl font-semibold text-white">🗑️ 回收站</h3>
					<p className="mt-2 text-sm text-slate-300">
						共 {deletedEntries.length} 个已删除条目。恢复后文件将回到原路径。
					</p>
				</div>
			</div>

			<div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
				<div className="min-w-[860px]">
				{/* Desktop table view (md+) */}
				<div className="hidden md:block">
					<div className="grid grid-cols-[minmax(260px,2fr)_120px_120px_minmax(220px,1fr)_200px] bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-400">
						<div>名称</div>
						<div>类型</div>
						<div>大小</div>
						<div>路径</div>
						<div>操作</div>
					</div>

					<div className="divide-y divide-white/5 bg-slate-950/40">
						{deletedEntries.map((entry) => (
							<div
								key={entry.id}
								className="grid grid-cols-[minmax(260px,2fr)_120px_120px_minmax(220px,1fr)_200px] items-center gap-4 px-4 py-3 text-sm"
							>
								<div className="min-w-0 truncate font-medium text-white">{entry.name}</div>
								<div className="text-slate-300">
									{entry.entryType === "DIRECTORY" ? "目录" : "文件"}
								</div>
								<div className="text-slate-300">{formatFileSize(entry.size)}</div>
								<div className="min-w-0 truncate text-xs text-slate-400">{entry.relativePath}</div>
								<div className="flex flex-wrap gap-2">
									{canDelete ? (
										<>
<RestoreButton fileEntryId={entry.id} entryName={entry.name} onRefresh={onRefresh} />
										<PermanentDeleteButton fileEntryId={entry.id} entryName={entry.name} onRefresh={onRefresh} />
										</>
									) : (
										<span className="text-xs text-slate-500">无权限</span>
									)}
								</div>
							</div>
						))}
					</div>
				</div>

				{/* Mobile card view (below md) */}
				<div className="md:hidden divide-y divide-white/5 bg-slate-950/40">
					{deletedEntries.map((entry) => (
						<div key={entry.id} className="px-4 py-3">
							<div className="min-w-0">
								<div className="truncate font-medium text-white">{entry.name}</div>
								<p className="mt-0.5 truncate text-xs text-slate-500">{entry.relativePath}</p>
							</div>
							<div className="mt-1.5 flex gap-3 text-xs text-slate-400">
								<span>{entry.entryType === "DIRECTORY" ? "目录" : "文件"}</span>
								<span>{formatFileSize(entry.size)}</span>
							</div>
							{canDelete ? (
								<div className="mt-2 flex flex-wrap gap-2">
									<RestoreButton fileEntryId={entry.id} entryName={entry.name} onRefresh={onRefresh} />
									<PermanentDeleteButton fileEntryId={entry.id} entryName={entry.name} onRefresh={onRefresh} />
								</div>
							) : (
								<span className="mt-2 inline-block text-xs text-slate-500">无权限</span>
							)}
						</div>
					))}
				</div>
				</div>
			</div>
		</article>
	);
}
