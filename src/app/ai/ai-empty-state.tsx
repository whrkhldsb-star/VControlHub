"use client";

/**
 * Empty-state panel for the AI chat surface.
 *
 * Renders when no `activeConv` is selected. Two variants:
 *   - no providers configured → CTA opens the provider panel.
 *   - providers exist         → CTA creates a new conversation.
 */
import { useI18n } from "@/lib/i18n/use-locale";

type Props = {
  hasProviders: boolean;
  onOpenProviders: () => void;
  onNewConv: () => void;
};

export function AiEmptyState({
  hasProviders,
  onOpenProviders,
  onNewConv,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-[var(--text-muted)]">
      <div className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] p-8 shadow-[var(--shadow-md)] backdrop-blur">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--accent)]">
          <svg
            className="h-7 w-7 opacity-80"
            fill="none"
            stroke="currentColor"
            width="24" height="24" viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.09-.75.202-.25.112-.499.268-.75.468M9.75 3.104c.251.023.501.09.75.202.25.112.499.268.75.468M5 14.5l-1.43 1.43a2.25 2.25 0 01-3.182 0l-.03-.03a2.25 2.25 0 010-3.182L5 14.5zm0 0l6.25-6.25"
            />
          </svg>
        </div>
        {!hasProviders ? (
          <>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {t("aiPage.emptyNoProvider")}
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
              {t("aiPage.emptyNoProviderHint")}
            </p>
            <button
              type="button"
              onClick={onOpenProviders}
              data-primary
              data-action-button data-variant="primary" className="mt-5 h-9 px-4 text-sm"
            >
              {t("aiPage.configProviders")}
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{t("aiPage.emptySelectConv")}</p>
            <button
              type="button"
              onClick={onNewConv}
              data-primary
              data-action-button data-variant="primary" className="h-9 px-4 text-sm"
            >
              {t("aiPage.newConversation")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
