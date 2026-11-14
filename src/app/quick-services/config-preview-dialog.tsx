"use client";

import { useI18n } from "@/lib/i18n/use-locale";

import { ActionButton } from "@/components/action-button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui-primitives";
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
	targetLabel?: string;
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
	const portSep = t("common.listSeparator");
	const volumeSep = t("common.sentenceSeparator");
	const volumeList = getVolumeMounts(item);
	const envCount = getEnvCount(item);

	return (
		<Dialog
			size="lg"
			placement="sheet"
			open
			onClose={onCancel}
			title={title}
			description={<>{body}{suffix}</>}
			footer={<>
				<ActionButton type="button" variant="secondary" onClick={onCancel}>
					{cancelLabel}
				</ActionButton>
				<ActionButton type="button" onClick={onConfirm}>
					{confirmLabel}
				</ActionButton>
			</>}
		>
			<div data-inset className="grid gap-2 p-3 text-xs text-[var(--text-secondary)]">
				<div>
					<span className="text-[var(--text-muted)]">{fieldService}</span>
					{item.name} ({item.slug})
				</div>
				<div>
					<span className="text-[var(--text-muted)]">{t("qsPage.targetNode")}{t("common.colon")}</span>
					{configPreview.targetLabel ?? t("qsPage.targetHubHost")}
				</div>
				<div>
					<span className="text-[var(--text-muted)]">{fieldImage}</span>
					{item.image}
				</div>
				<div>
					<span className="text-[var(--text-muted)]">{fieldPort}</span>
					{t("qsPage.configPortMapping", { container: getPrimaryContainerPort(item), host: port })}
				</div>
				<div>
					<span className="text-[var(--text-muted)]">{fieldExtraPort}</span>
					{(item.extraPorts ?? []).length > 0
						? item.extraPorts!.map((p) => t("qsPage.configPortEntry", { container: p.container, host: p.host })).join(portSep)
						: noneLabel}
				</div>
				<div>
					<span className="text-[var(--text-muted)]">{fieldEnv}</span>
					{t("qsPage.configEnvCount", { count: envCount })}
				</div>
				<div>
					<span className="text-[var(--text-muted)]">{fieldVolume}</span>
					{volumeList.length > 0
						? volumeList.map((v) => t("qsPage.configVolumeEntry", { host: v.host, container: v.container })).join(volumeSep)
						: noneLabel}
				</div>
			</div>
			<Notice tone="warning" compact className="mt-4">
				{warning}
			</Notice>
		</Dialog>
	);
}
