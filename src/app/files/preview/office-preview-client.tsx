"use client";

import { useI18n } from "@/lib/i18n/use-locale";

export function OfficePreviewClient({
	href,
	name,
}: {
	href: string;
	name: string;
	driver: string;
}) {
	const { t } = useI18n();
	return (
		<div className="flex flex-col items-center gap-4 py-12 text-center text-[var(--text-secondary)]">
			<span className="text-6xl">📝</span>
			<div className="space-y-2">
				<p className="text-lg text-[var(--text-secondary)]">{t("officePreview.title")}</p>
				<p className="max-w-xl text-sm text-[var(--text-muted)]">{t("officePreview.desc")}</p>
			</div>
			<a
				href={href.includes("?") ? `${href}&download=1` : `${href}?download=1`}
				download
				data-tone="cyan"
				className="rounded-xl border border-cyan-400/30 px-5 py-2.5 text-sm font-medium text-[var(--text-primary)] transition hover:bg-cyan-400/20"
			>
				{t("officePreview.download")}
			</a>
			<p className="text-xs text-[var(--text-muted)]" title={name}>
				{t("officePreview.fileName").replace("{name}", name)}
			</p>
		</div>
	);
}
