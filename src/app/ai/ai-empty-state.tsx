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
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center text-[var(--text-muted)]">
      <svg
        className="mb-4 h-16 w-16 opacity-20"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1}
          d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.09-.75.202-.25.112-.499.268-.75.468M9.75 3.104c.251.023.501.09.75.202.25.112.499.268.75.468M5 14.5l-1.43 1.43a2.25 2.25 0 01-3.182 0l-.03-.03a2.25 2.25 0 010-3.182L5 14.5zm0 0l6.25-6.25"
        />
      </svg>
      {!hasProviders ? (
        <>
          <p className="text-sm font-medium text-[var(--text-secondary)]">
            {t("aiPage.emptyNoProvider")}
          </p>
          <p className="mt-2 max-w-md text-xs leading-5 text-[var(--text-muted)]">
            {t("aiPage.emptyNoProviderHint")}
          </p>
          <button
            type="button"
            onClick={onOpenProviders}
            className="mt-5 h-9 rounded-xl bg-cyan-500/20 px-4 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/30"
          >
            {t("aiPage.configProviders")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm mb-3">{t("aiPage.emptySelectConv")}</p>
          <button
            type="button"
            onClick={onNewConv}
            className="h-9 rounded-xl bg-cyan-500/20 px-4 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/30"
          >
            {t("aiPage.newConversation")}
          </button>
        </>
      )}
    </div>
  );
}
