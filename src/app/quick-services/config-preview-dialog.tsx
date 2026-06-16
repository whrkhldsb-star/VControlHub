"use client";

/**
 * `ConfigPreviewDialog` — final confirmation modal shown after the user
 * picks a port in the install dialog (or hits "更新" on an installed
 * service). Displays the resolved image / ports / env / volume plan and
 * calls `onConfirm` to either enqueue an install or trigger an update.
 *
 * Extracted from `quick-services-client.tsx` (TR-036 T37) so the
 * confirmation body ships in its own lazy chunk. Renders only when
 * `configPreview` is non-null, and the dialog body is heavy enough
 * (image / extra-ports / volume listing) to justify code-splitting.
 */

type ConfigPreviewItemLike = {
	slug: string;
	name: string;
	image: string;
	extraPorts?: Array<{ container: number; host: number }> | null;
	defaultPort: number;
	envKeyCount?: number | null;
	volumesJson?: Array<{ host: string; container: string }> | null;
	internalPort?: number | null;
};

type ConfigPreviewLike = {
	action: "install" | "update";
	item: ConfigPreviewItemLike;
	port: number;
};

type ConfigPreviewDialogProps = {
	configPreview: ConfigPreviewLike | null;
	getEnvCount: (item: ConfigPreviewItemLike) => number;
	getVolumeMounts: (item: ConfigPreviewItemLike) => Array<{ host: string; container: string }>;
	getPrimaryContainerPort: (item: ConfigPreviewItemLike) => number;
	onCancel: () => void;
	onConfirm: () => void;
};

export function ConfigPreviewDialog({
	configPreview,
	getEnvCount,
	getVolumeMounts,
	getPrimaryContainerPort,
	onCancel,
	onConfirm,
}: ConfigPreviewDialogProps) {
	if (!configPreview) return null;
	const { action, item, port } = configPreview;
	const title = action === "install" ? "确认安装配置" : "确认更新配置";
	const body =
		action === "install"
			? "安装会拉取镜像并创建 qs-* 容器。"
			: "更新会拉取当前镜像并重建 qs-* 容器。";
	const confirmLabel = action === "install" ? "确认安装" : "确认更新";
	const volumeList = getVolumeMounts(item);

	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
			onClick={onCancel}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="mx-0 w-full max-w-lg rounded-t-2xl border border-cyan-400/20 bg-[#0c0f1a] p-6 shadow-2xl sm:mx-4 sm:rounded-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
				<p className="text-sm leading-6 text-slate-300">
					{body}请确认端口、挂载和公开访问边界后继续。
				</p>
				<div data-card className="mt-4 grid gap-2  p-3 text-xs text-slate-300">
					<div>
						<span className="text-slate-500">服务：</span>
						{item.name} ({item.slug})
					</div>
					<div>
						<span className="text-slate-500">镜像：</span>
						{item.image}
					</div>
					<div>
						<span className="text-slate-500">端口：</span>
						容器 {getPrimaryContainerPort(item)} → 宿主机 {port}
					</div>
					<div>
						<span className="text-slate-500">额外端口：</span>
						{(item.extraPorts ?? []).length > 0
							? item.extraPorts!.map((p) => `${p.container}→${p.host}`).join("、")
							: "无"}
					</div>
					<div>
						<span className="text-slate-500">环境变量：</span>
						{getEnvCount(item)} 个键（不展示密钥值）
					</div>
					<div>
						<span className="text-slate-500">宿主机挂载：</span>
						{volumeList.length > 0
							? volumeList.map((v) => `${v.host} → ${v.container}`).join("；")
							: "无"}
					</div>
				</div>
				<div data-tone="amber" className="mt-4 rounded-xl border border-amber-400/20 p-3 text-xs leading-5 text-amber-100">
					公开端口不会经过 VControlHub 登录鉴权；若服务暴露到公网，请确认防火墙、VPN、反代或应用自身账号已配置。
				</div>
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
						className="min-h-11 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition"
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
