"use client";

export function OfficePreviewClient({
	href,
	name,
}: {
	href: string;
	name: string;
	driver: string;
}) {
	return (
		<div className="flex flex-col items-center gap-4 py-12 text-center text-slate-400">
			<span className="text-6xl">📝</span>
			<div className="space-y-2">
				<p className="text-lg text-slate-200">此 Office 文件暂不支持稳定在线渲染预览</p>
				<p className="max-w-xl text-sm text-slate-500">
					Office Online 需要 Microsoft 服务器直接访问文件 URL；当前文件预览使用登录态保护的主站受控流，
					不会把私有文件暴露为公网直连地址。请下载后使用本地软件打开。
				</p>
			</div>
			<a
				href={href.includes("?") ? `${href}&download=1` : `${href}?download=1`}
				download
				className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-5 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
			>
				⬇ 下载文件
			</a>
			<p className="text-xs text-slate-600" title={name}>
				文件名：{name}
			</p>
		</div>
	);
}
