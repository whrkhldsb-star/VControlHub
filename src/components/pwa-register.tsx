"use client"; /** * PwaRegister — registers the VControlHub service worker and exposes the * user-visible PWA state: offline banner + update prompt. */
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast-provider";
import { createLogger } from "@/lib/logging";
import { useI18n } from "@/lib/i18n/use-locale";

const logger = createLogger("pwa-register");

const OFFLINE_WARM_ROUTES = [
  "/dashboard",
  "/servers",
  "/files",
  "/settings",
  "/status",
] as const;
type PwaUpdateState = { waiting: ServiceWorker | null; visible: boolean };
function isStandaloneDisplayMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
export function PwaRegister() {
  const { addToast } = useToast();
  const { t } = useI18n();
  const [isOffline, setIsOffline] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [updateState, setUpdateState] = useState<PwaUpdateState>({
    waiting: null,
    visible: false,
  });
  const updateRequestedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setTimeout(() => setIsOffline(!navigator.onLine), 0);
    setTimeout(() => setIsInstalled(isStandaloneDisplayMode()), 0);
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
      logger.info("service worker unsupported");
      return;
    }
    const sw = navigator.serviceWorker;
    let refreshing = false;
    const handleControllerChange = () => {
      // A first-time service-worker install also emits controllerchange. Do
      // not reload in that case: it can race with login/form navigation.
      if (!updateRequestedRef.current || refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    sw.addEventListener("controllerchange", handleControllerChange);
    const notifyUpdateAvailable = (worker: ServiceWorker | null) => {
      setUpdateState({ waiting: worker, visible: true });
      addToast(
        "info",
        `${t("pwa.update.available")} — ${t("pwa.update.description")}`,
        0,
      );
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
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          notifyUpdateAvailable(installing);
        }
      });
    };
    sw.register("/sw.js", { scope: "/" })
      .then((registration) => {
        logger.info("service worker registered", { scope: registration.scope });
        if (registration.waiting) {
          notifyUpdateAvailable(registration.waiting);
        }
        warmOfflineRoutes(registration);
        registration.addEventListener("updatefound", () =>
          onUpdateFound(registration),
        );
      })
      .catch((err: unknown) => {
        logger.error("service worker registration failed", err);
        addToast("error", t("pwa.register.failed"));
      });
    return () => {
      sw.removeEventListener("controllerchange", handleControllerChange);
    };
  }, [addToast, t]);
  const refreshToUpdate = () => {
    const worker = updateState.waiting;
    if (worker) {
      updateRequestedRef.current = true;
      worker.postMessage({ type: "VCH_PWA_SKIP_WAITING" });
      return;
    }
    window.location.reload();
  };
  if (!isOffline && !updateState.visible && !isInstalled) return null;
  return (
    <div
      className="fixed bottom-24 left-1/2 z-[90] w-[min(calc(100vw-2rem),34rem)] -translate-x-1/2 space-y-2 md:bottom-5"
      aria-live="polite"
    >
      {" "}
      {isOffline && (
        <div className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning)] shadow-[var(--shadow-lg)] backdrop-blur">
          {" "}
          <div className="font-medium">{t("pwa.status.offlineTitle")}</div>{" "}
          <div className="mt-1 text-xs opacity-80">
            {t("pwa.status.offlineDescription")}
          </div>{" "}
        </div>
      )}{" "}
      {updateState.visible && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--accent-border)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur">
          {" "}
          <div>
            {" "}
            <div className="font-medium">{t("pwa.update.available")}</div>{" "}
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {t("pwa.update.description")}
            </div>{" "}
          </div>{" "}
          <div className="flex shrink-0 items-center gap-2">
            {" "}
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              onClick={() =>
                setUpdateState((state) => ({ ...state, visible: false }))
              }
            >
              {" "}
              {t("pwa.update.dismiss")}{" "}
            </button>{" "}
            <button
              type="button"
              className="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-hover)]"
              onClick={refreshToUpdate}
            >
              {" "}
              {t("pwa.update.refresh")}{" "}
            </button>{" "}
          </div>{" "}
        </div>
      )}{" "}
    </div>
  );
}
