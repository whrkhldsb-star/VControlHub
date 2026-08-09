"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n/use-locale";

type PendingDiscard =
  | { kind: "navigate"; href: string }
  | { kind: "close" }
  | { kind: "action"; run: () => void }
  | null;

export function useUnsavedChangesGuard(input: {
  dirty: boolean;
  onDiscard?: () => void;
}) {
  const { dirty, onDiscard } = input;
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState<PendingDiscard>(null);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const interceptNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;
      const anchor = event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const current = new URL(window.location.href);
      if (destination.pathname === current.pathname && destination.search === current.search) return;
      event.preventDefault();
      setPending({
        kind: "navigate",
        href: `${destination.pathname}${destination.search}${destination.hash}`,
      });
    };
    document.addEventListener("click", interceptNavigation, true);
    return () => document.removeEventListener("click", interceptNavigation, true);
  }, [dirty]);

  const requestDiscard = () => {
    if (!dirty) {
      onDiscard?.();
      return;
    }
    setPending({ kind: "close" });
  };

  const requestAction = (action: () => void) => {
    if (!dirty) {
      action();
      return;
    }
    setPending({ kind: "action", run: action });
  };

  const discardDialog = (
    <ConfirmDialog
      open={pending !== null}
      title={t("common.unsaved.title")}
      description={t("common.unsaved.description")}
      cancelLabel={t("common.unsaved.stay")}
      confirmLabel={t("common.unsaved.discard")}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const action = pending;
        setPending(null);
        if (action?.kind === "navigate") router.push(action.href);
        else if (action?.kind === "close") onDiscard?.();
        else if (action?.kind === "action") action.run();
      }}
      closeOnBackdrop={false}
    />
  );

  return { requestAction, requestDiscard, discardDialog };
}
