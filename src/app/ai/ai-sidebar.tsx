"use client";

import type { ConvItem } from "./ai-types";
import { EmptyState } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

interface SidebarProps {
  showSidebar: boolean;
  conversations: ConvItem[];
  activeConvId: string | null;
  onNewConv: () => void;
  onSelectConv: (id: string) => void;
  onDeleteConv: (id: string) => void;
  onToggleSidebar: (v: boolean) => void;
  onToggleProviders: () => void;
}

export function AiSidebar({
  showSidebar,
  conversations,
  activeConvId,
  onNewConv,
  onSelectConv,
  onDeleteConv,
  onToggleSidebar,
  onToggleProviders,
}: SidebarProps) {
	const { t } = useI18n();
	return (
		<>
      {/* Mobile sidebar backdrop */}
      {showSidebar && (
        <div
          className="fixed inset-0 z-30 bg-[var(--overlay)] max-md:block hidden"
          onClick={() => onToggleSidebar(false)}
        />
      )}
      {showSidebar && (
        <div className="flex w-64 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_96%,transparent)] max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-72">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">AI</p>
              <h1 className="text-sm font-semibold text-[var(--text-primary)]">{t("aiPage.sidebarTitle")}</h1>
            </div>
            <button
              type="button"
              onClick={onNewConv}
              data-primary
              className="h-8 rounded-xl bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-hover)]"
            >
              {t("aiPage.newConversation")}
            </button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
            {conversations.length === 0 && (
              <EmptyState>{t("aiPage.emptyConversations")}</EmptyState>
            )}
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 transition ${
                  activeConvId === conv.id
                    ? "border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
                    : "border border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
 }`}
                onClick={() => onSelectConv(conv.id)}
              >
                <svg className="h-4 w-4 flex-shrink-0 opacity-50" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span className="flex-1 truncate text-xs font-medium">{conv.title}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConv(conv.id);
                  }}
                  aria-label={t("aiPage.deleteConversationAria").replace("{title}", conv.title)}
                  className="text-[var(--danger)]/60 opacity-0 transition group-hover:opacity-100 hover:text-[var(--danger)]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Bottom actions */}
          <div className="space-y-1 border-t border-[var(--border)] p-2">
            <button type="button"
              onClick={onToggleProviders}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.857L8 16H6v2H4v2H2v-2.586l7.44-7.44A6 6 0 0121 9z" />
              </svg>
              {t("aiPage.providerManagement")}
            </button>
            <button
              type="button"
              onClick={() => onToggleSidebar(false)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] lg:hidden"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
              {t("aiPage.collapseSidebar")}
            </button>
          </div>
        </div>
      )}

      {!showSidebar && (
        <button
          type="button"
          onClick={() => onToggleSidebar(true)}
          className="hidden"
          aria-label={t("aiPage.openSidebar")}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </>
  );
}
