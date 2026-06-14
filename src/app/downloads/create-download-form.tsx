/**
 * Real `CreateDownloadForm` component.
 *
 * TR-036: Split out from `downloads-client.tsx` so the new-download
 * form (single + batch modes, server select, target path, file name,
 * category, speed limit) only ships in the client chunk when the
 * user actually opens "+ 新建下载". The page itself ships the task
 * list, filter bar, and global stats; the form chunk arrives on
 * first click.
 *
 * Form state stays owned by the parent (`downloads-client.tsx`) so
 * that the "close + reopen" UX is preserved and so that the chunk
 * boundary is purely about deferring code, not about data flow.
 * The lazy wrapper short-circuits to null when `open === false`,
 * letting the parent drop the `{showForm && (...)}` wrapper.
 */
"use client";

export interface DownloadFormState {
	url: string;
	serverId: string;
	targetPath: string;
	fileName: string;
	category: string;
	maxSpeedKb: string;
	batchMode: boolean;
	batchText: string;
}

export interface CreateDownloadFormProps {
	open: boolean;
	form: DownloadFormState;
	submitting: boolean;
	batchModeError: string | null;
	servers: Array<{
		id: string;
		name: string;
		host: string;
		storagePath: string;
		storageDriver: "LOCAL" | "SFTP";
		directAccessMode: "PROXY" | "DIRECT" | "AUTO";
		directAccessAvailable: boolean;
		accessTransport: "direct" | "relay";
		accessStatusLabel: string;
		accessDescription: string;
	}>;
	selectedServerId: string;
	onFormChange: (next: DownloadFormState) => void;
	onServerChange: (serverId: string) => void;
	onSubmit: () => void;
}

const categories = [
	{ value: "", label: "未分类", icon: "📦" },
	{ value: "video", label: "影视", icon: "🎬" },
	{ value: "music", label: "音乐", icon: "🎵" },
	{ value: "software", label: "软件", icon: "💿" },
	{ value: "document", label: "文档", icon: "📄" },
	{ value: "image", label: "图片", icon: "🖼️" },
];

function urlTypeLabel(url: string) {
	if (url.startsWith("magnet:?")) return "🧲 磁力链接";
	if (url.startsWith("https://")) return "🔒 HTTPS";
	if (url.startsWith("http://")) return "🔓 HTTP";
	return "❓ 未知";
}

export function CreateDownloadForm({
	open,
	form,
	submitting,
	batchModeError,
	servers,
	selectedServerId,
	onFormChange,
	onServerChange,
	onSubmit,
}: CreateDownloadFormProps) {
	if (!open) return null;

	const selectedServer = servers.find((s) => s.id === selectedServerId);

	return (
		<div data-card className="mb-6 p-5 space-y-4">
			<h3 className="text-lg font-semibold text-white">新建下载任务</h3>

			{/* Batch mode toggle */}
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={() => onFormChange({ ...form, batchMode: !form.batchMode })}
					className={`rounded-lg border px-3 py-1.5 text-xs transition ${
						form.batchMode
							? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
							: "border-white/[0.06] bg-white/[0.02] text-slate-500 hover:bg-white/[0.05]"
					}`}
				>
					📋 批量模式
				</button>
				{form.batchMode && <span className="text-xs text-slate-500">每行一个链接</span>}
			</div>

			{form.batchMode ? (
				<div className="space-y-1.5">
					<label
						htmlFor="download-batch-links"
						className="text-xs font-medium text-white/50 tracking-wide"
					>
						下载链接（每行一个）
					</label>
					<textarea
						id="download-batch-links"
						value={form.batchText}
						onChange={(e) => onFormChange({ ...form, batchText: e.target.value })}
						rows={6}
						placeholder={"https://example.com/file1.zip\nhttps://example.com/file2.zip\nhttps://example.com/file3.iso"}
						className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white font-mono outline-none focus:border-cyan-400/30 placeholder:text-white/20 resize-y"
					/>
					<p className="text-[11px] text-slate-500">
						批量模式仅用于多个 HTTP/HTTPS 链接；磁力/BT 链接请单独创建任务，不要与普通链接混用。
					</p>
					{batchModeError && <p className="text-[11px] text-rose-300">{batchModeError}</p>}
				</div>
			) : (
				<div className="space-y-1.5">
					<label
						htmlFor="download-url"
						className="text-xs font-medium text-white/50 tracking-wide"
					>
						下载链接
					</label>
					<input
						id="download-url"
						type="url"
						value={form.url}
						onChange={(e) => onFormChange({ ...form, url: e.target.value })}
						placeholder="https://example.com/file.zip 或 magnet:?xt=urn:btih:..."
						className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30 placeholder:text-white/20"
					/>
					{form.url && <p className="text-[11px] text-slate-500">{urlTypeLabel(form.url)}</p>}
				</div>
			)}

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="downloadServer">目标 VPS</label>
					<select
						id="downloadServer"
						value={form.serverId}
						onChange={(e) => onServerChange(e.target.value)}
						className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30"
					>
						{servers.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name} ({s.host})
							</option>
						))}
					</select>
					{selectedServer && (
						<div
							className={`rounded-lg border px-3 py-2 text-[11px] leading-5 ${
								selectedServer.accessTransport === "direct"
									? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-100"
									: "border-amber-400/20 bg-amber-400/[0.06] text-amber-100"
							}`}
						>
							<div className="font-medium">{selectedServer.accessStatusLabel}</div>
							<div className="mt-0.5 opacity-80">{selectedServer.accessDescription}</div>
						</div>
					)}
				</div>
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="downloadTargetPath">保存路径</label>
					<input
						id="downloadTargetPath"
						value={form.targetPath}
						onChange={(e) => onFormChange({ ...form, targetPath: e.target.value })}
						placeholder="/root/downloads"
						className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30 placeholder:text-white/20"
					/>
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-3">
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="downloadFileName">文件名（可选）</label>
					<input
						id="downloadFileName"
						value={form.fileName}
						onChange={(e) => onFormChange({ ...form, fileName: e.target.value })}
						placeholder="留空自动"
						className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30 placeholder:text-white/20"
					/>
				</div>
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="downloadCategory">分类</label>
					<select
						id="downloadCategory"
						value={form.category}
						onChange={(e) => onFormChange({ ...form, category: e.target.value })}
						className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30"
					>
						{categories.map((c) => (
							<option key={c.value} value={c.value}>
								{c.icon} {c.label}
							</option>
						))}
					</select>
				</div>
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="downloadMaxSpeed">限速 KB/s（可选）</label>
					<input
						id="downloadMaxSpeed"
						value={form.maxSpeedKb}
						onChange={(e) => onFormChange({ ...form, maxSpeedKb: e.target.value })}
						type="number"
						placeholder="不限"
						className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30 placeholder:text-white/20"
					/>
				</div>
			</div>

			{form.url?.startsWith("magnet:") && (
				<div
					data-tone="amber"
					className="rounded-xl border border-amber-400/20 px-4 py-3 text-xs text-amber-200/70"
				>
					🧲 磁力链接采用中转模式：本机 aria2 RPC 下载 → SFTP 传输到目标 VPS → 清理临时文件。支持实时进度追踪。
				</div>
			)}

			<div
				data-tone="cyan"
				className="rounded-xl border border-cyan-400/15 px-4 py-3 text-xs leading-5 text-cyan-100"
			>
				<p className="font-medium">
					完成后的“下载文件”按钮和文件管理使用同一套访问策略。
				</p>
				<p className="mt-1 text-cyan-100/70/70">
					不在下载页单独启动传输模式；选择目标 VPS 后按其存储直连设置显示当前真实模式，直连可用时走
					Direct Gateway，未配置或切回中转时走网站 SFTP 中转。
				</p>
			</div>

			<div className="flex gap-3 pt-2">
				<button
					type="button"
					onClick={onSubmit}
					disabled={submitting || Boolean(batchModeError) || !form.serverId}
					className="rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
				>
					{submitting ? "提交中…" : "开始下载"}
				</button>
			</div>
		</div>
	);
}
