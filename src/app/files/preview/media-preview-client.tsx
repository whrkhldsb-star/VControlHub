"use client";

import { useState } from "react";
import { DirectAccessButton } from "./direct-access-button";

export function MediaPreviewClient({
	href,
	name,
	mimeType,
	driver,
	nodeId,
	relativePath,
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
	const [streamUrl, setStreamUrl] = useState<string | null>(null);
	const src = streamUrl ?? href;
	const handleStreamUrl = (url: string) => {
		setStreamUrl(url);
	};

	return (
		<div className="flex flex-col items-center gap-4">
			{/* Controlled SFTP stream button for remote nodes */}
			{driver === "SFTP" && nodeId && relativePath ? (
				<DirectAccessButton
					nodeId={nodeId}
					relativePath={relativePath}
					driver={driver}
					fileName={name}
					onUrlReady={handleStreamUrl}
				/>
			) : null}

			{/* Media player */}
			{isVideo ? (
				<video
					src={src}
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
					<span className="text-lg text-slate-300">{name}</span>
					<audio src={src} controls className="w-full max-w-lg" autoPlay>
						您的浏览器不支持音频播放。
					</audio>
				</div>
			) : null}

			{/* Status indicator */}
			{streamUrl ? (
				<span className="text-xs text-cyan-300">🎛️ 已切换播放流量路径</span>
			) : driver === "SFTP" ? (
				<span className="text-xs text-slate-500">
					默认通过网站服务器中转播放；可在上方切换为目标服务器直连，适合大视频/音频。
				</span>
			) : null}
		</div>
	);
}
