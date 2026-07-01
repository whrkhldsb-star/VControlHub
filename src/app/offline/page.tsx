"use client";

/**
 * Offline fallback page — served by the service worker when the user is
 * disconnected and the requested page is not in the PWA cache.
 *
 * This page is intentionally public (no session required) so the SW can
 * always render it without a 401 redirect. Read-only content only — no
 * data fetching, no client-side state that would fail without network.
 *
 * Why a client component: the SW caches the rendered HTML, and we want
 * the page to respect the user's `localStorage` locale setting on each
 * visit. The cached HTML is the React markup + a hydration script that
 * reads useI18n() on the client, so locale changes are picked up.
 *
 * The list of "available offline" routes is a static hint; the real cache
 * status is determined by the service worker. We list the four PWA cache
 * targets (dashboard / servers / files / settings static sections) that
 * the service worker is configured to pre-cache on install.
 */

import { useI18n } from "@/lib/i18n/use-locale";

interface CachedRoute {
  href: string;
  labelKey: "pwa.offline.dashboard" | "pwa.offline.servers" | "pwa.offline.files" | "pwa.offline.settings";
}

const CACHED_ROUTES: ReadonlyArray<CachedRoute> = [
  { href: "/dashboard", labelKey: "pwa.offline.dashboard" },
  { href: "/servers", labelKey: "pwa.offline.servers" },
  { href: "/files", labelKey: "pwa.offline.files" },
  { href: "/settings", labelKey: "pwa.offline.settings" },
];

export default function OfflinePage() {
  const { t } = useI18n();

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 bg-slate-50 text-[var(--color-action-fg)] dark:bg-[var(--surface)] dark:text-[var(--text-primary)]"
      aria-labelledby="offline-title"
    >
      <div className="max-w-md w-full text-center space-y-6">
        <div
          aria-hidden="true"
          className="mx-auto w-16 h-16 rounded-full border-2 border-slate-300 dark:border-slate-700 flex items-center justify-center"
        >
          <span className="text-3xl">📡</span>
        </div>

        <h1
          id="offline-title"
          className="text-2xl font-semibold tracking-tight"
        >
          {t("pwa.offline.title")}
        </h1>

        <p className="text-sm leading-relaxed text-[var(--text-muted)] dark:text-[var(--text-secondary)]">
          {t("pwa.offline.description")}
        </p>

        <div className="pt-2">
          <h2 className="text-xs uppercase tracking-wider text-[var(--text-muted)] dark:text-[var(--text-muted)] mb-3">
            {t("pwa.offline.cachedRoutes")}
          </h2>
          <ul className="grid grid-cols-2 gap-2 text-sm" role="list">
            {CACHED_ROUTES.map((route) => (
              <li key={route.href}>
                <a
                  href={route.href}
                  className="block rounded-lg border border-slate-200 dark:border-slate-800 bg-[var(--surface)] dark:bg-[var(--surface)] px-3 py-2 hover:border-slate-300 dark:hover:border-[var(--border)] transition-colors"
                >
                  {t(route.labelKey)}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center min-h-11 px-5 rounded-lg bg-[var(--surface)] dark:bg-slate-100 text-[var(--text-primary)] dark:text-[var(--color-action-fg)] text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {t("pwa.offline.retry")}
          </a>
        </div>
      </div>
    </main>
  );
}
