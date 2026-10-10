"use client";

import { ActionButton } from "@/components/action-button";
import { FormField, Notice, Spinner } from "@/components/ui-primitives";
import { Dialog } from "@/components/ui/dialog";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
/**
 * `InstallDialog` — port-picker modal shown when the user clicks
 * "一键安装" on a Quick Service card. Lets the user override the
 * default port, runs a debounced port-availability probe, and shows
 * the resolved image / container-port / env / volume plan before the
 * final confirmation dialog.
 *
 * Extracted from `quick-services-client.tsx` (TR-036 T37). Owns its own
 * `customPort` / `portCheck` / debounce-timer state so the parent only
 * passes the open/close + "ready to advance" hooks. NOT lazy-loaded —
 * the install flow is the first thing a new admin hits, so the chunk
 * has to be available as soon as they click the tile.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";

type InstallDialogItem = {
	slug: string;
	name: string;
	image: string;
	extraPorts?: Array<{ container: number; host: number }> | null;
	defaultPort: number;
	envKeyCount?: number | null;
	volumesJson?: Array<{ host: string; container: string }> | null;
	internalPort?: number | null;
};

type InstallDialogProps = {
	open: InstallDialogItem | null;
	targetLabel: string;
	serverId?: string;
	onClose: () => void;
	onAdvance: (input: { slug: string; name: string; port: number }) => void;
	getEnvCount: (item: InstallDialogItem) => number;
	getVolumeMounts: (item: InstallDialogItem) => Array<{ host: string; container: string }>;
	getPrimaryContainerPort: (item: InstallDialogItem) => number;
};

type PortCheckState = {
	available: boolean;
	usedBy: string | null;
	checking: boolean;
};

export function InstallDialog({
	open,
	targetLabel,
	serverId,
	onClose,
	onAdvance,
	getEnvCount,
	getVolumeMounts,
	getPrimaryContainerPort,
}: InstallDialogProps) {
	const { t } = useI18n();
	const [customPort, setCustomPort] = useState<string>("");
	const [portCheck, setPortCheck] = useState<PortCheckState | null>(null);
	const portCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const portCheckGenRef = useRef(0);

	const checkPortAvailability = useCallback(async (port: number) => {
		const gen = ++portCheckGenRef.current;
		setPortCheck({ available: false, usedBy: null, checking: true });
		try {
			const data = await csrfFetch<{ available: boolean; usedBy?: string | null }>(
				`/api/quick-services/check-port?port=${encodeURIComponent(String(port))}${serverId ? `&serverId=${encodeURIComponent(serverId)}` : ""}`,
			);
			if (gen !== portCheckGenRef.current) return;
			setPortCheck({ available: data.available, usedBy: data.usedBy ?? null, checking: false });
		} catch (err) {
			if (gen !== portCheckGenRef.current) return;
			setPortCheck({
				available: false,
				usedBy: getErrorMessage(err, t("qsPage.checkFailed")),
				checking: false,
			});
		}
	}, [serverId, t]);

	// Reset state every time the dialog opens — the cascading render is the
	// desired behavior: open dialog → seed default port + immediate check.
	// (Following the same disable pattern as other dialogs in this repo,
	// e.g. `file-upload-dropzone.tsx`, `users-client.tsx`.)
	/* eslint-disable react-hooks/set-state-in-effect */
	useEffect(() => {
		if (!open) return;
		setCustomPort(String(open.defaultPort));
		setPortCheck({ available: false, usedBy: null, checking: true });
		void checkPortAvailability(open.defaultPort);
		return () => {
			if (portCheckTimer.current) clearTimeout(portCheckTimer.current);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot init per open
	}, [open?.slug, checkPortAvailability]);
	/* eslint-enable react-hooks/set-state-in-effect */

	const handlePortInput = useCallback(
		(value: string) => {
			setCustomPort(value);
			if (portCheckTimer.current) clearTimeout(portCheckTimer.current);
			const port = Number(value);
			if (!value || isNaN(port) || port < 1 || port > 65535) {
				setPortCheck(null);
				return;
			}
			portCheckTimer.current = setTimeout(() => {
				void checkPortAvailability(port);
			}, 400);
		},
		[checkPortAvailability],
	);

	if (!open) return null;

	const port = Number(customPort);
	const portValid = !isNaN(port) && port >= 1 && port <= 65535;
	const containerPort = getPrimaryContainerPort(open);
	const envCount = getEnvCount(open);
	const volumeCount = getVolumeMounts(open).length;
	// Require a successful availability check (not merely "not known busy") before Confirm.
	const advanceDisabled =
		!portValid || !portCheck || portCheck.checking || !portCheck.available;

	const handleAdvance = () => {
		if (!open || !portValid) return;
		if (!portCheck || portCheck.checking || !portCheck.available) return;
		onAdvance({ slug: open.slug, name: open.name, port });
	};

	const handleAutoAllocate = async () => {
		try {
			const data = await csrfFetch<{ port?: number }>(
				`/api/quick-services/check-port?action=allocate&preferred=${open.defaultPort}${serverId ? `&serverId=${encodeURIComponent(serverId)}` : ""}`,
			);
			if (data.port) {
				handlePortInput(String(data.port));
			}
		} catch {
			/* ignore — user can still type manually */
		}
	};

	return (
		<Dialog
			open
			onClose={onClose}
			title={t("qsPage.installTitle", { name: open.name })}
			description={t("qsPage.installSubtitle")}
			footer={<>
				<ActionButton type="button" variant="secondary" onClick={onClose}>
					{t("qsPage.cancel")}
				</ActionButton>
				<ActionButton type="button" onClick={handleAdvance} disabled={advanceDisabled}>
					{t("qsPage.confirmInstall")}
				</ActionButton>
			</>}
		>
			<div className="space-y-4">
				<Notice tone="info" compact>
					<span className="font-semibold text-[var(--text-primary)]">{t("qsPage.targetNode")}</span>{t("common.colon")}{targetLabel}
				</Notice>

				<FormField
					label={t("qsPage.portNumberLabel")}
					htmlFor="quick-service-install-port"
					hint={t("qsPage.recommendedPort", { port: open.defaultPort })}
					actions={
						<ActionButton size="xs" variant="ghost" onClick={handleAutoAllocate}>
							{t("qsPage.autoAssign")}
						</ActionButton>
					}
				>
					<div className="relative">
						<input
							id="quick-service-install-port"
							type="number"
							min={1}
							max={65535}
							value={customPort}
							onChange={(e) => handlePortInput(e.target.value)}
							data-input
							data-error={portCheck && !portCheck.checking && !portCheck.available ? "true" : undefined}
							className={cn(UI_INPUT, "pr-20 font-mono")}
							placeholder="1-65535"
						/>
						{portCheck?.checking && (
							<div className="absolute right-3 top-1/2 -translate-y-1/2">
								<Spinner size="sm" label={t("common.loading")} />
							</div>
						)}
						{portCheck && !portCheck.checking && (
							<div
								className={cn(
									"absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium",
									portCheck.available ? "text-[var(--success)]" : "text-[var(--danger)]",
								)}
							>
								{portCheck.available ? t("qsPage.portAvailable") : t("qsPage.portInUse")}
							</div>
						)}
					</div>
				</FormField>

				{portCheck && !portCheck.available && portCheck.usedBy && (
					<Notice tone="danger" compact>{t("qsPage.portInUseDetail", { usedBy: portCheck.usedBy })}</Notice>
				)}

				<div data-inset className="p-3 text-xs text-[var(--text-secondary)]">
					<div className="ui-title-caption">{t("qsPage.configPreviewTitle")}</div>
					<div className="mt-2 grid gap-1.5 text-[var(--text-primary)]">
						<span>{t("qsPage.imageLabel", { image: open.image ?? t("qsPage.imagePending") })}</span>
						<span>
							{t("qsPage.containerPortLabel", { container: containerPort ?? t("qsPage.containerPortDash"), host: customPort || String(open.defaultPort) })}
						</span>
						<span>{t("qsPage.envVarsLabel", { count: envCount })}</span>
						<span>{t("qsPage.volumesLabel", { count: volumeCount })}</span>
					</div>
				</div>
			</div>
		</Dialog>
	);
}
