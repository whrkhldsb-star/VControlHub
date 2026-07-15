"use client";

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
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

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
	onClose,
	onAdvance,
	getEnvCount,
	getVolumeMounts,
	getPrimaryContainerPort,
}: InstallDialogProps) {
	const { t } = useI18n();
	const dialogRef = useDialogFocus<HTMLDivElement>({ open: open !== null, onClose });
	const [customPort, setCustomPort] = useState<string>("");
	const [portCheck, setPortCheck] = useState<PortCheckState | null>(null);
	const portCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const checkPortAvailability = useCallback(async (port: number) => {
		setPortCheck({ available: false, usedBy: null, checking: true });
		try {
			const data = await csrfFetch<{ available: boolean; usedBy?: string | null }>(
				`/api/quick-services/check-port?port=${encodeURIComponent(String(port))}`,
			);
			setPortCheck({ available: data.available, usedBy: data.usedBy ?? null, checking: false });
		} catch (err) {
			setPortCheck({
				available: false,
				usedBy: err instanceof Error ? err.message : t("qsPage.checkFailed"),
				checking: false,
			});
		}
	}, [t]);

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
	const advanceDisabled = portCheck?.checking || (portCheck ? !portCheck.available : false);

	const handleAdvance = () => {
		if (!open || !portValid) return;
		if (portCheck && !portCheck.available) return;
		onAdvance({ slug: open.slug, name: open.name, port });
	};

	const handleAutoAllocate = async () => {
		try {
			const data = await csrfFetch<{ port?: number }>(
				`/api/quick-services/check-port?action=allocate&preferred=${open.defaultPort}`,
			);
			if (data.port) {
				handlePortInput(String(data.port));
			}
		} catch {
			/* ignore — user can still type manually */
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				className="w-full max-w-md mx-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-root)] p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{t("qsPage.installTitle").replace("{name}", open.name)}</h3>
				<p className="text-xs text-[var(--text-muted)] mb-4">{t("qsPage.installSubtitle")}</p>

				<div className="space-y-3">
					<label className="block">
						<span className="text-xs text-[var(--text-muted)] mb-1 block">{t("qsPage.portNumberLabel")}</span>
						<div className="relative">
							<input
								type="number"
								min={1}
								max={65535}
								value={customPort}
								onChange={(e) => handlePortInput(e.target.value)}
								className={`w-full rounded-lg border bg-[var(--surface-elevated)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition ${
									portCheck
										? portCheck.available
											? "border-[var(--success-border)] focus:border-[var(--success-border)]"
											: "border-[var(--danger-border)] focus:border-[var(--danger-border)]"
										: "border-[var(--border)] focus:border-[var(--color-action-border)]"
								}`}
								placeholder="1-65535"
							/>
							{portCheck?.checking && (
								<div className="absolute right-3 top-1/2 -translate-y-1/2">
									<div className="w-4 h-4 border-2 border-[var(--color-action-border)]/30 border-t-[var(--color-action)] rounded-full animate-spin" />
								</div>
							)}
							{portCheck && !portCheck.checking && (
								<div
									className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${
										portCheck.available ? "text-[var(--success)]" : "text-[var(--danger)]"
									}`}
								>
									{portCheck.available ? t("qsPage.portAvailable") : t("qsPage.portInUse")}
								</div>
							)}
						</div>
					</label>

					{portCheck && !portCheck.available && portCheck.usedBy && (
						<div className="text-xs text-[var(--danger)]/80 bg-[var(--danger)]/[0.10] rounded-lg px-3 py-2 border border-[var(--danger-border)]">
							{t("qsPage.portInUseDetail").replace("{usedBy}", portCheck.usedBy)}
						</div>
					)}

					<div data-tone="cyan" className="rounded-xl border border-[var(--color-action-border)]/15 p-3 text-xs text-[var(--text-primary)]">
						<div className="font-semibold">{t("qsPage.configPreviewTitle")}</div>
						<div className="mt-2 grid gap-1.5 text-[var(--text-primary)]">
							<span>{t("qsPage.imageLabel").replace("{image}", open.image ?? t("qsPage.imagePending"))}</span>
							<span>
								{t("qsPage.containerPortLabel").replace("{container}", String(containerPort ?? t("qsPage.containerPortDash"))).replace("{host}", customPort || String(open.defaultPort))}
							</span>
							<span>{t("qsPage.envVarsLabel").replace("{count}", String(envCount))}</span>
							<span>{t("qsPage.volumesLabel").replace("{count}", String(volumeCount))}</span>
						</div>
					</div>

					<div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
						<span>{t("qsPage.recommendedPort").replace("{port}", String(open.defaultPort))}</span>
						<button
							type="button"
							onClick={handleAutoAllocate}
							className="text-[var(--color-action)]/70 hover:text-[var(--color-action)] underline underline-offset-2"
						>
							{t("qsPage.autoAssign")}
						</button>
					</div>
				</div>

				<div className="flex items-center justify-end gap-3 mt-6">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] transition"
					>
						{t("qsPage.cancel")}
					</button>
					<button
						type="button"
						onClick={handleAdvance}
						disabled={advanceDisabled}
						className="rounded-lg bg-[var(--color-action)] px-4 py-2 text-xs font-semibold text-[var(--color-action-fg)] hover:bg-[var(--color-action-bg)] transition disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{t("qsPage.confirmInstall")}
					</button>
				</div>
			</div>
		</div>
	);
}
