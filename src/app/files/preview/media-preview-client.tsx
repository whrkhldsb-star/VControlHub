"use client";

export function MediaPreviewClient({
	href,
	name,
	mimeType,
	driver,
}: {
	href: string;
	name: string;
	mimeType: string;
	driver: string;
	nodeId: string;
	relativePath: string;
}) {
	const isVideo = mimeType.startsWith("video/");
	const isAudio = mimeType.startsWith("audio/");

	return (
		<div className="flex flex-col items-center gap-4">
			{isVideo ? (
				<video
					src={href}
					controls
					autoPlay
					className="max-h-[80vh] max-w-full rounded-2xl"
				>
					<track kind="captions" />
					您的浏览器不支持视频播放。
				</video>
			) : isAudio ? (
				<div className="flex flex-col items-center gap-4 py-8">
					<span className="text-6xl">🎵</span>
					<span className="text-lg text-slate-300 light:text-slate-700">{name}</span>
					<audio src={href} controls className="w-full max-w-lg" autoPlay>
						您的浏览器不支持音频播放。
					</audio>
				</div>
			) : null}

			{driver === "SFTP" ? (
				<span className="text-xs text-slate-500">
					在线预览固定使用网站受控流，避免目标服务器直连被浏览器策略或跨域阻拦；下载按钮仍按节点设置使用唯一的有效路径。
				</span>
			) : null}
		</div>
	);
}
