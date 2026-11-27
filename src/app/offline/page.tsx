"use client";

/**
 * Offline fallback page — served by the service worker when the user is
 * disconnected and the requested page is not in the PWA cache.
 *
 * This page is intentionally public (no session required) so the SW can
 * always render it without a 401 redirect. Read-only content only — no
 * data fetching, no client-side state that would fail without network.
 */

import { useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { StatusScreen } from "@/components/page-shell";
import { Radio } from "@/components/icons";
import { ActionButton } from "@/components/action-button";

export default function OfflinePage() {
  const { t } = useI18n();
  const [retrying, setRetrying] = useState(false);

  return (
    <StatusScreen
      className="min-h-dvh"
      titleId="offline-title"
      icon={<Radio />}
      eyebrow={t("pwa.offline.eyebrow")}
      title={t("pwa.offline.title")}
      description={t("pwa.offline.description")}
      details={
        <p data-inset className="px-4 py-3 text-left text-xs leading-relaxed text-[var(--text-muted)]">
          {t("pwa.offline.securityNotice")}
        </p>
      }
      actions={
        <>
          {/* Reload the address that failed: the browser makes a real request to find out whether the network is
              back, and the person lands where they were going. */}
          <ActionButton
            variant="primary"
            size="lg"
            loading={retrying}
            onClick={() => {
              setRetrying(true);
              window.location.reload();
            }}
          >
            {retrying ? t("pwa.offline.retrying") : t("pwa.offline.retry")}
          </ActionButton>
          {/* A plain link on purpose: a full request, not a client navigation that would stay offline. */}
          <a href="/dashboard" data-action-button="" data-variant="secondary" data-size="lg">
            {t("pwa.offline.tryDashboard")}
          </a>
        </>
      }
    />
  );
}
