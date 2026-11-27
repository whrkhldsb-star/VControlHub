"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n/use-locale";
import {
  acquireDirtyHistoryGuard,
  isScopeSwitchReleasing,
  registerActiveWork,
  releaseDirtyHistoryGuard,
} from "./active-work-guard";
import { NAVIGATION_REQUEST_EVENT, type NavigationRequestDetail } from "./navigation-request";

/** Marks the history entry pushed so that Back can be answered with a question. */
const GUARD_ENTRY = "__vchUnsavedGuard";

type SharedBackGuardEntry = {
  id: symbol;
  guardHref: string;
  isLeaving: () => boolean;
  markLeaving: () => void;
  promptBack: () => void;
};

const activeBackGuards: SharedBackGuardEntry[] = [];
let sharedPopStateAttached = false;

function pushSharedGuardEntry() {
  window.history.pushState({ ...(window.history.state ?? {}), [GUARD_ENTRY]: true }, "", window.location.href);
}

function handleSharedPopState() {
  if (isScopeSwitchReleasing() || activeBackGuards.length === 0) return;
  if (activeBackGuards.some((entry) => entry.isLeaving())) return;
  pushSharedGuardEntry();
  activeBackGuards[activeBackGuards.length - 1]?.promptBack();
}

function registerSharedBackGuard(entry: SharedBackGuardEntry) {
  activeBackGuards.push(entry);
  acquireDirtyHistoryGuard();
  if (!window.history.state?.[GUARD_ENTRY]) pushSharedGuardEntry();
  if (!sharedPopStateAttached) {
    window.addEventListener("popstate", handleSharedPopState);
    sharedPopStateAttached = true;
  }
  return () => {
    const idx = activeBackGuards.findIndex((item) => item.id === entry.id);
    if (idx !== -1) activeBackGuards.splice(idx, 1);
    const remaining = releaseDirtyHistoryGuard();
    if (activeBackGuards.length === 0 && sharedPopStateAttached) {
      window.removeEventListener("popstate", handleSharedPopState);
      sharedPopStateAttached = false;
    }
    // Saved or reset while still on this page: drop the extra entry only when
    // no other dirty guard remains and no customer-scope switch is tearing down
    // the tree (which would race `router.refresh()`).
    if (remaining === 0 && !entry.isLeaving() && !isScopeSwitchReleasing() && window.history.state?.[GUARD_ENTRY]) {
      if (window.location.href === entry.guardHref) {
        window.history.back();
      } else {
        // The entry was repurposed by an in-page switch (a tab): keep it, drop only the marker.
        const { [GUARD_ENTRY]: _marker, ...rest } = window.history.state as Record<string, unknown>;
        window.history.replaceState(rest, "", window.location.href);
      }
    }
  };
}

function markAllBackGuardsLeaving() {
  for (const entry of activeBackGuards) entry.markLeaving();
}

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
    if (!dirty) return;
    return registerActiveWork("dirtyForm", 1);
  }, [dirty]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || isScopeSwitchReleasing()) return;
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
      // Cross-customer notification links own their own scope-switch confirmation dialog.
      if (anchor.hasAttribute("data-scope-switch-link")) return;
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
  // changes a single shared sentinel entry sits on top of the history so even
  // multiple mounted dirty forms prompt once and confirm cleanly with one go(-2).
  useEffect(() => {
    if (!dirty) return;
    const id = Symbol("dirtyBackGuard");
    return registerSharedBackGuard({
      id,
      guardHref: window.location.href,
      isLeaving: () => leaving.current,
      markLeaving: () => { leaving.current = true; },
      promptBack: () => setPending({ kind: "back" }),
    });
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
          markAllBackGuardsLeaving();
          leaving.current = true;
          router.push(action.href);
        } else if (action?.kind === "back") {
          // Past the guard entry and this page's own entry.
          markAllBackGuardsLeaving();
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
