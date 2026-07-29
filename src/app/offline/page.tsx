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

export default function OfflinePage() {
  const { t } = useI18n();
  const [retrying, setRetrying] = useState(false);

  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16 text-[var(--text-primary)]"
      aria-labelledby="offline-title"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,157,255,0.13),transparent_55%),var(--page-bg)]"
      />
      <div className="relative w-full max-w-md space-y-6 rounded-3xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] p-8 text-center shadow-[var(--shadow-lg)] backdrop-blur-xl">
        <div
          aria-hidden="true"
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)]"
        >
          <span className="text-3xl">📡</span>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">Offline</p>
          <h1 id="offline-title" className="mt-2 text-2xl font-semibold tracking-tight">
            {t("pwa.offline.title")}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
            {t("pwa.offline.description")}
          </p>
        </div>

        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left text-xs leading-relaxed text-[var(--text-muted)]">
          {t("pwa.offline.securityNotice")}
        </p>

        <div className="border-t border-[var(--border-subtle)] pt-5">
          <a
            href="/dashboard"
            onClick={() => setRetrying(true)}
            aria-busy={retrying}
            data-primary
            data-action-button data-variant="primary" className="inline-flex min-h-11 items-center justify-center px-5 text-sm"
          >
            {retrying ? t("pwa.offline.retrying") : t("pwa.offline.retry")}
          </a>
        </div>
      </div>
    </main>
  );
}
