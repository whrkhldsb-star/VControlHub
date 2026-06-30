"use client";

import { useI18n } from "@/lib/i18n/use-locale";

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
	const { t } = useI18n();
	if (!configPreview) return null;
	const { action, item, port } = configPreview;
	const title = action === "install" ? t("qsPage.configConfirmTitle.install") : t("qsPage.configConfirmTitle.update");
	const body =
		action === "install"
			? t("qsPage.configConfirmBody.install")
			: t("qsPage.configConfirmBody.update");
	const confirmLabel = action === "install" ? t("qsPage.configConfirmLabel.install") : t("qsPage.configConfirmLabel.update");
	const cancelLabel = t("qsPage.configConfirmCancel");
	const noneLabel = t("qsPage.configFieldNone");
	const warning = t("qsPage.configConfirmWarning");
	const suffix = t("qsPage.configConfirmSuffix");
	const fieldService = t("qsPage.configFieldService");
	const fieldImage = t("qsPage.configFieldImage");
	const fieldPort = t("qsPage.configFieldPort");
	const fieldExtraPort = t("qsPage.configFieldExtraPort");
	const fieldEnv = t("qsPage.configFieldEnv");
	const fieldVolume = t("qsPage.configFieldVolume");
	const portMapping = t("qsPage.configPortMapping");
	const envCountTpl = t("qsPage.configEnvCount");
	const volumeEntryTpl = t("qsPage.configVolumeEntry");
	const portEntryTpl = t("qsPage.configPortEntry");
	const portSep = t("qsPage.configPortListSeparator");
	const volumeSep = t("qsPage.configVolumeListSeparator");
	const volumeList = getVolumeMounts(item);
	const envCount = getEnvCount(item);

	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
			onClick={onCancel}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="mx-0 w-full max-w-lg rounded-t-2xl border border-cyan-400/20 bg-[var(--surface-root)] p-6 shadow-2xl sm:mx-4 sm:rounded-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
				<p className="text-sm leading-6 text-[var(--text-secondary)]">
					{body}{suffix}
				</p>
				<div data-card className="mt-4 grid gap-2  p-3 text-xs text-[var(--text-secondary)]">
					<div>
						<span className="text-[var(--text-muted)]">{fieldService}</span>
						{item.name} ({item.slug})
					</div>
					<div>
						<span className="text-[var(--text-muted)]">{fieldImage}</span>
						{item.image}
					</div>
					<div>
						<span className="text-[var(--text-muted)]">{fieldPort}</span>
						{portMapping.replace("{container}", String(getPrimaryContainerPort(item))).replace("{host}", String(port))}
					</div>
					<div>
						<span className="text-[var(--text-muted)]">{fieldExtraPort}</span>
						{(item.extraPorts ?? []).length > 0
							? item.extraPorts!.map((p) => portEntryTpl.replace("{container}", String(p.container)).replace("{host}", String(p.host))).join(portSep)
							: noneLabel}
					</div>
					<div>
						<span className="text-[var(--text-muted)]">{fieldEnv}</span>
						{envCountTpl.replace("{count}", String(envCount))}
					</div>
					<div>
						<span className="text-[var(--text-muted)]">{fieldVolume}</span>
						{volumeList.length > 0
							? volumeList.map((v) => volumeEntryTpl.replace("{host}", v.host).replace("{container}", v.container)).join(volumeSep)
							: noneLabel}
					</div>
				</div>
				<div data-tone="amber" className="mt-4 rounded-xl border border-amber-400/20 p-3 text-xs leading-5 text-amber-100">
					{warning}
				</div>
				<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<button
						type="button"
						onClick={onCancel}
						className="min-h-11 rounded-lg border border-white/[0.1] px-4 py-2 text-xs text-[var(--text-muted)] hover:bg-white/[0.04] transition"
					>
						{cancelLabel}
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
