"use client";

/**
 * PwaRegister — registers the VControlHub service worker and exposes the
 * user-visible PWA state: offline banner + update prompt.
 */
import { useEffect, useState } from "react";

import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";

const OFFLINE_WARM_ROUTES = ["/dashboard", "/servers", "/files", "/settings", "/status"] as const;

type PwaUpdateState = {
	waiting: ServiceWorker | null;
	visible: boolean;
};

function isStandaloneDisplayMode() {
	if (typeof window === "undefined") return false;
	return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PwaRegister() {
	const { addToast } = useToast();
	const { t } = useI18n();
	const [isOffline, setIsOffline] = useState(false);
	const [isInstalled, setIsInstalled] = useState(false);
	const [updateState, setUpdateState] = useState<PwaUpdateState>({ waiting: null, visible: false });

	useEffect(() => {
		if (typeof window === "undefined") return;
		setIsOffline(!navigator.onLine);
		setIsInstalled(isStandaloneDisplayMode());

		const handleOnline = () => {
			setIsOffline(false);
			addToast("success", t("pwa.status.online"));
		};
		const handleOffline = () => {
			setIsOffline(true);
			addToast("warning", t("pwa.status.offline"), 6000);
		};
		const handleAppInstalled = () => {
			setIsInstalled(true);
			addToast("success", t("pwa.install.installed"));
		};

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);
		window.addEventListener("appinstalled", handleAppInstalled);
		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
			window.removeEventListener("appinstalled", handleAppInstalled);
		};
	}, [addToast, t]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		if (!navigator.serviceWorker) {
			console.info("[VControlHub PWA]", t("pwa.register.unsupported"));
			return;
		}

		const sw = navigator.serviceWorker;
		let refreshing = false;

		const handleControllerChange = () => {
			if (refreshing) return;
			refreshing = true;
			window.location.reload();
		};

		sw.addEventListener("controllerchange", handleControllerChange);

		const notifyUpdateAvailable = (worker: ServiceWorker | null) => {
			setUpdateState({ waiting: worker, visible: true });
			addToast("info", `${t("pwa.update.available")} — ${t("pwa.update.description")}`, 0);
		};

		const warmOfflineRoutes = (registration: ServiceWorkerRegistration) => {
			const target = registration.active || navigator.serviceWorker.controller;
			if (!target) return;
			for (const pathname of OFFLINE_WARM_ROUTES) {
				target.postMessage({ type: "VCH_PWA_WARM_ROUTE", pathname });
			}
		};

		const onUpdateFound = (registration: ServiceWorkerRegistration) => {
			const installing = registration.installing;
			if (!installing) return;
			installing.addEventListener("statechange", () => {
				if (installing.state === "installed" && navigator.serviceWorker.controller) {
					notifyUpdateAvailable(installing);
				}
			});
		};

		sw.register("/sw.js", { scope: "/" })
			.then((registration) => {
				console.info("[VControlHub PWA] service worker registered", registration.scope);
				if (registration.waiting) {
					notifyUpdateAvailable(registration.waiting);
				}
				warmOfflineRoutes(registration);
				registration.addEventListener("updatefound", () => onUpdateFound(registration));
			})
			.catch((err: unknown) => {
				console.error("[VControlHub PWA] service worker registration failed", err);
				addToast("error", t("pwa.register.failed"));
			});

		return () => {
			sw.removeEventListener("controllerchange", handleControllerChange);
		};
	}, [addToast, t]);

	const refreshToUpdate = () => {
		const worker = updateState.waiting;
		if (worker) {
			worker.postMessage({ type: "VCH_PWA_SKIP_WAITING" });
			return;
		}
		window.location.reload();
	};

	if (!isOffline && !updateState.visible && !isInstalled) return null;

	return (
		<div className="fixed bottom-24 left-1/2 z-[90] w-[min(calc(100vw-2rem),34rem)] -translate-x-1/2 space-y-2 md:bottom-5" aria-live="polite">
			{isOffline && (
				<div className="rounded-2xl border border-amber-400/30 bg-amber-950/90 px-4 py-3 text-sm text-amber-50 shadow-2xl backdrop-blur light:bg-amber-50 light:text-amber-900">
					<div className="font-medium">{t("pwa.status.offlineTitle")}</div>
					<div className="mt-1 text-xs opacity-80">{t("pwa.status.offlineDescription")}</div>
				</div>
			)}
			{updateState.visible && (
				<div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-action-border)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-primary)] shadow-2xl backdrop-blur">
					<div>
						<div className="font-medium">{t("pwa.update.available")}</div>
						<div className="mt-1 text-xs text-[var(--text-muted)]">{t("pwa.update.description")}</div>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<button type="button" className="rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={() => setUpdateState((state) => ({ ...state, visible: false }))}>
							{t("pwa.update.dismiss")}
						</button>
						<button type="button" className="rounded-lg bg-[var(--color-action)] px-3 py-1.5 text-xs font-medium text-[var(--color-action-fg)] hover:bg-[var(--color-action-hover)]" onClick={refreshToUpdate}>
							{t("pwa.update.refresh")}
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
