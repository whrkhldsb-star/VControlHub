"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n/use-locale";
import { NAVIGATION_REQUEST_EVENT, type NavigationRequestDetail } from "./navigation-request";

/** Marks the history entry pushed so that Back can be answered with a question. */
const GUARD_ENTRY = "__vchUnsavedGuard";

type PendingDiscard =
  | { kind: "navigate"; href: string }
  | { kind: "back" }
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
  // Set once the user agreed to leave, so the guard steps aside.
  const leaving = useRef(false);

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

  // Keyboard shortcuts and global search navigate without a link click.
  useEffect(() => {
    if (!dirty) return;
    const interceptRequest = (event: Event) => {
      if (leaving.current) return;
      event.preventDefault();
      setPending({ kind: "navigate", href: (event as CustomEvent<NavigationRequestDetail>).detail.href });
    };
    window.addEventListener(NAVIGATION_REQUEST_EVENT, interceptRequest);
    return () => window.removeEventListener(NAVIGATION_REQUEST_EVENT, interceptRequest);
  }, [dirty]);

  // Browser Back unmounted the form without a word. While there are unsaved
  // changes an extra entry for this same page sits on top of the history:
  // Back lands on this page again, and the guard asks before really leaving.
  useEffect(() => {
    if (!dirty) return;
    const pushGuardEntry = () => {
      window.history.pushState({ ...(window.history.state ?? {}), [GUARD_ENTRY]: true }, "", window.location.href);
    };
    if (!window.history.state?.[GUARD_ENTRY]) pushGuardEntry();
    const onPopState = () => {
      if (leaving.current) return;
      pushGuardEntry();
      setPending({ kind: "back" });
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      // Saved or reset while still on this page: drop the extra entry, or
      // the next Back would seem to do nothing.
      if (!leaving.current && window.history.state?.[GUARD_ENTRY]) window.history.back();
    };
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
        if (action?.kind === "navigate") {
          leaving.current = true;
          router.push(action.href);
        } else if (action?.kind === "back") {
          // Past the guard entry and this page's own entry.
          leaving.current = true;
          window.history.go(-2);
        } else if (action?.kind === "close") onDiscard?.();
        else if (action?.kind === "action") action.run();
      }}
      closeOnBackdrop={false}
    />
  );

  return { requestAction, requestDiscard, discardDialog };
}
