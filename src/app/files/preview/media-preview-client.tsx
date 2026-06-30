"use client";

import { useI18n } from "@/lib/i18n/use-locale";

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
	const { t } = useI18n();
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
					{t("mediaPreview.videoUnsupported")}
				</video>
			) : isAudio ? (
				<div className="flex flex-col items-center gap-4 py-8">
					<span className="text-6xl">🎵</span>
					<span className="text-lg text-[var(--text-secondary)]">{name}</span>
					<audio src={href} controls className="w-full max-w-lg" autoPlay>
						{t("mediaPreview.audioUnsupported")}
					</audio>
				</div>
			) : null}

			{driver === "SFTP" ? (
				<span className="text-xs text-[var(--text-muted)]">{t("mediaPreview.sftpNote")}</span>
			) : null}
		</div>
	);
}
