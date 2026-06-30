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
    <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-3 bg-[var(--surface-subtle)]">
      {/* Mobile sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className="md:hidden flex-shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-secondary)] light:hover:text-slate-800 transition"
        aria-label={t("common.openSidebar")}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-[var(--text-primary)] truncate">{activeConv.title}</h3>
        <p className="text-[10px] text-[var(--text-muted)]">
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
          className="h-7 px-2.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-secondary)] light:hover:text-slate-800 transition"
        >
          {t("aiPage.settings")}
        </button>
        <button
          onClick={onClearMessages}
          className="h-7 px-2.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-rose-500/10 hover:text-rose-400 transition"
          title={t("aiPage.clearMessagesTitle")}
        >
          {t("aiPage.clear")}
        </button>
        <button
          onClick={onRenameConv}
          className="h-7 px-2.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-secondary)] light:hover:text-slate-800 transition"
        >
          {t("aiPage.rename")}
        </button>
        <button
          onClick={onExportConv}
          className="h-7 px-2.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-secondary)] light:hover:text-slate-800 transition"
          title={t("aiPage.exportTitle")}
        >
          {t("aiPage.export")}
        </button>
      </div>
    </div>
  );
}
