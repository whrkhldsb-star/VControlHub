"use client";

/**
 * `pendingUninstall` confirmation modal — extracted from
 * `quick-services-client.tsx` (TR-036) so the dialog body ships in
 * its own lazy chunk. Renders only when the user clicks "卸载" on
 * an installed Quick Service.
 */

type PendingUninstallDialogProps = {
	pending: { slug: string; name: string; deleteVolumes: boolean } | null;
	onCancel: () => void;
	onConfirm: () => void;
	onToggleDeleteVolumes: (next: boolean) => void;
};

export function PendingUninstallDialog({
	pending,
	onCancel,
	onConfirm,
	onToggleDeleteVolumes,
}: PendingUninstallDialogProps) {
	if (!pending) return null;
	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
			onClick={onCancel}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="确认卸载快捷服务"
				className="mx-0 w-full max-w-md rounded-t-2xl border border-rose-400/20 bg-[#0c0f1a] p-6 shadow-2xl sm:mx-4 sm:rounded-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-lg font-semibold text-white mb-2">确认卸载快捷服务</h3>
				<p className="text-sm leading-6 text-slate-300">
					将卸载 <span className="font-semibold text-white">{pending.name}</span>，容器将被删除。默认保留宿主机数据目录，方便重新安装后继续使用。
				</p>
				<label
					data-tone="rose"
					className="mt-4 flex items-start gap-3 rounded-xl border border-rose-400/15 p-3 text-sm text-rose-100"
				>
					<input
						type="checkbox"
						checked={pending.deleteVolumes}
						onChange={(e) => onToggleDeleteVolumes(e.target.checked)}
						className="mt-1 h-4 w-4 rounded border-rose-300/40 bg-transparent text-rose-500"
					/>
					<span>
						<span className="block font-medium">同时删除数据目录</span>
						<span className="mt-1 block text-xs leading-5 text-rose-100/75">
							仅删除该服务模板记录的 `/opt/` 或 `/srv/` 下挂载目录；不会删除 Docker socket、时区文件或根目录。
						</span>
					</span>
				</label>
				<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<button
						type="button"
						onClick={onCancel}
						className="min-h-11 rounded-lg border border-white/[0.1] px-4 py-2 text-xs text-slate-400 hover:bg-white/[0.04] transition"
					>
						取消
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className="min-h-11 rounded-lg bg-rose-500 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-400 transition"
					>
						确认卸载
					</button>
				</div>
			</div>
		</div>
	);
}
