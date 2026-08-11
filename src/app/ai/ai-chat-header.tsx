"use client";

import { useI18n } from "@/lib/i18n/use-locale";

import type { ConvItem, Provider, ModelCapabilities } from "./ai-types";
import { ActionButton } from "@/components/action-button";
import { Download, Pencil, Settings, Trash2 } from "@/components/icons";

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
    <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_96%,transparent)] px-3 py-2.5 shadow-[var(--shadow-sm)] backdrop-blur sm:gap-3 sm:px-4 sm:py-3">
      {/* Mobile sidebar toggle */}
      <button
		type="button"
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
          {t("aiPage.modelCaps", { provider: activeProvider?.name || t("aiPage.unknown"), model: activeConv.model })}
          {activeConv.enableVision && t("aiPage.vision")}
          {currentModelCaps.video && t("aiPage.videoCap")}
          {currentModelCaps.audio && t("aiPage.audioCap")}
          {currentModelCaps.document && t("aiPage.documentCap")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <ActionButton type="button" variant="secondary"
          onClick={onToggleSettings}
          aria-label={t("aiPage.settings")}
          title={t("aiPage.settings")}
          className="flex h-9 w-9 shrink-0 items-center justify-center !p-0 lg:h-8 lg:w-auto lg:!px-2.5 lg:!text-xs">
          <Settings size={15} aria-hidden="true" />
          <span className="hidden lg:ml-1.5 lg:inline">{t("aiPage.settings")}</span>
        </ActionButton>
        <ActionButton type="button" variant="danger"
          onClick={onClearMessages}
          aria-label={t("aiPage.clearMessagesTitle")}
          title={t("aiPage.clearMessagesTitle")}
          className="flex h-9 w-9 shrink-0 items-center justify-center !p-0 lg:h-8 lg:w-auto lg:!px-2.5 lg:!text-xs">
          <Trash2 size={15} aria-hidden="true" />
          <span className="hidden lg:ml-1.5 lg:inline">{t("aiPage.clear")}</span>
        </ActionButton>
        <ActionButton type="button" variant="secondary"
          onClick={onRenameConv}
          aria-label={t("aiPage.rename")}
          title={t("aiPage.rename")}
          className="flex h-9 w-9 shrink-0 items-center justify-center !p-0 lg:h-8 lg:w-auto lg:!px-2.5 lg:!text-xs">
          <Pencil size={15} aria-hidden="true" />
          <span className="hidden lg:ml-1.5 lg:inline">{t("aiPage.rename")}</span>
        </ActionButton>
        <ActionButton type="button" variant="secondary"
          onClick={onExportConv}
          aria-label={t("aiPage.exportTitle")}
          title={t("aiPage.exportTitle")}
          className="flex h-9 w-9 shrink-0 items-center justify-center !p-0 lg:h-8 lg:w-auto lg:!px-2.5 lg:!text-xs">
          <Download size={15} aria-hidden="true" />
          <span className="hidden lg:ml-1.5 lg:inline">{t("aiPage.export")}</span>
        </ActionButton>
      </div>
    </div>
  );
}
