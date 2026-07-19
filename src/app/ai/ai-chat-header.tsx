"use client";

import { useI18n } from "@/lib/i18n/use-locale";

import type { ConvItem, Provider, ModelCapabilities } from "./ai-types";

interface ChatHeaderProps {
	activeConv: ConvItem;
	activeProvider: Provider | null;
	currentModelCaps: ModelCapabilities;
	onToggleSidebar: () => void;
  onToggleSettings: () => void;
  onClearMessages: () => void;
  onRenameConv: () => void;
  onExportConv: () => void;
}

export function AiChatHeader({
  activeConv,
	activeProvider,
	currentModelCaps,
  onToggleSidebar,
  onToggleSettings,
  onClearMessages,
  onRenameConv,
  onExportConv,
}: ChatHeaderProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_96%,transparent)] px-4 py-3 shadow-[var(--shadow-sm)] backdrop-blur">
      {/* Mobile sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className="flex-shrink-0 text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] md:hidden"
        aria-label={t("common.openSidebar")}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{activeConv.title}</h3>
        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
          {t("aiPage.modelCaps").replace("{provider}", activeProvider?.name || t("aiPage.unknown")).replace("{model}", activeConv.model)}
          {activeConv.enableVision && t("aiPage.vision")}
          {currentModelCaps.video && t("aiPage.videoCap")}
          {currentModelCaps.audio && t("aiPage.audioCap")}
          {currentModelCaps.document && t("aiPage.documentCap")}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onToggleSettings}
         data-action-button data-variant="secondary" className="h-8 !px-2.5 !text-xs">
          {t("aiPage.settings")}
        </button>
        <button
          onClick={onClearMessages}
          title={t("aiPage.clearMessagesTitle")}
         data-action-button data-variant="danger" className="h-8 !px-2.5 !text-xs">
          {t("aiPage.clear")}
        </button>
        <button
          onClick={onRenameConv}
         data-action-button data-variant="secondary" className="h-8 !px-2.5 !text-xs">
          {t("aiPage.rename")}
        </button>
        <button
          onClick={onExportConv}
          title={t("aiPage.exportTitle")}
         data-action-button data-variant="secondary" className="h-8 !px-2.5 !text-xs">
          {t("aiPage.export")}
        </button>
      </div>
    </div>
  );
}
