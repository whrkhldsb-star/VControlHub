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
    <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      {/* Mobile sidebar toggle */}
      <button
		type="button"
        onClick={onToggleSidebar}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] md:hidden"
        aria-label={t("common.openSidebar")}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] md:basis-64">
        <h1 className="line-clamp-2 break-words text-base font-semibold text-[var(--text-primary)]" title={activeConv.title}>{activeConv.title}</h1>
        <p className="mt-0.5 break-words text-xs text-[var(--text-muted)]">
          {t("aiPage.modelCaps", { provider: activeProvider?.name || t("aiPage.unknown"), model: activeConv.model })}
          {activeConv.enableVision && t("aiPage.vision")}
          {currentModelCaps.video && t("aiPage.videoCap")}
          {currentModelCaps.audio && t("aiPage.audioCap")}
          {currentModelCaps.document && t("aiPage.documentCap")}
        </p>
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-2">
        <ActionButton type="button" variant="secondary"
          onClick={onToggleSettings}
          aria-label={t("aiPage.settings")}
          title={t("aiPage.settings")}
          className="flex h-9 w-9 shrink-0 items-center justify-center !p-0 lg:h-8 lg:w-auto lg:!px-2.5 lg:!text-sm">
          <Settings size={15} aria-hidden="true" />
          <span className="hidden lg:ml-1.5 lg:inline">{t("aiPage.settings")}</span>
        </ActionButton>
        <ActionButton type="button" variant="danger"
          onClick={onClearMessages}
          aria-label={t("aiPage.clearMessagesTitle")}
          title={t("aiPage.clearMessagesTitle")}
          className="flex h-9 w-9 shrink-0 items-center justify-center !p-0 lg:h-8 lg:w-auto lg:!px-2.5 lg:!text-sm">
          <Trash2 size={15} aria-hidden="true" />
          <span className="hidden lg:ml-1.5 lg:inline">{t("aiPage.clear")}</span>
        </ActionButton>
        <ActionButton type="button" variant="secondary"
          onClick={onRenameConv}
          aria-label={t("aiPage.rename")}
          title={t("aiPage.rename")}
          className="flex h-9 w-9 shrink-0 items-center justify-center !p-0 lg:h-8 lg:w-auto lg:!px-2.5 lg:!text-sm">
          <Pencil size={15} aria-hidden="true" />
          <span className="hidden lg:ml-1.5 lg:inline">{t("aiPage.rename")}</span>
        </ActionButton>
        <ActionButton type="button" variant="secondary"
          onClick={onExportConv}
          aria-label={t("aiPage.exportTitle")}
          title={t("aiPage.exportTitle")}
          className="flex h-9 w-9 shrink-0 items-center justify-center !p-0 lg:h-8 lg:w-auto lg:!px-2.5 lg:!text-sm">
          <Download size={15} aria-hidden="true" />
          <span className="hidden lg:ml-1.5 lg:inline">{t("aiPage.export")}</span>
        </ActionButton>
      </div>
    </header>
  );
}
