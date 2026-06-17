"use client";

/**
 * PwaRegister — registers the VControlHub service worker on the client.
 *
 * Mounted once from the root layout. Its only job is to:
 *   1. Check `navigator.serviceWorker` is available (graceful no-op when not).
 *   2. Register `/sw.js` with scope `/`.
 *   3. Listen for `updatefound` events and surface a "new version available"
 *      toast via the global toast system.
 *
 * No UI is rendered by this component; it is purely a side-effect carrier.
 * A console.info is emitted on successful registration so QA can confirm
 * the service worker is wired up in the browser DevTools.
 */
import { useEffect } from "react";

import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";

export function PwaRegister() {
	const { addToast } = useToast();
	const { t } = useI18n();

	useEffect(() => {
		if (typeof window === "undefined") return;
		// Hard safety: never crash if `navigator.serviceWorker` is absent
		// (older browsers, test environments, or the property was undefined
		// after a previous test wiped it).
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

		const onUpdateFound = (registration: ServiceWorkerRegistration) => {
			const installing = registration.installing;
			if (!installing) return;
			installing.addEventListener("statechange", () => {
				if (installing.state === "installed" && navigator.serviceWorker.controller) {
					addToast(
						"info",
						`${t("pwa.update.available")} — ${t("pwa.update.description")}`,
					);
				}
			});
		};

		sw.register("/sw.js", { scope: "/" })
			.then((registration) => {
				console.info("[VControlHub PWA] service worker registered", registration.scope);
				if (registration.waiting) {
					addToast(
						"info",
						`${t("pwa.update.available")} — ${t("pwa.update.description")}`,
					);
				}
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

	return null;
}
