"use client";

import { useRef, useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";

import type { ConvItem, ModelInfo, Provider, ModelCapabilities } from "./ai-types";
import { ActionButton } from "@/components/action-button";
import { Download, Pencil, Settings, Trash2 } from "@/components/icons";
import { useDismiss } from "@/components/ui/menu";

interface ChatHeaderProps {
  activeConv: ConvItem;
  activeProvider: Provider | null;
  currentModelCaps: ModelCapabilities;
  /** Live model list of the active provider (empty until probed). */
  modelList?: ModelInfo[];
  /** One-step model switch (PATCH + refresh). */
  onQuickSwitchModel?: (model: string) => void;
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
  modelList = [],
  onQuickSwitchModel,
  onToggleSidebar,
  onToggleSettings,
  onClearMessages,
  onRenameConv,
  onExportConv,
}: ChatHeaderProps) {
  const { t } = useI18n();
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useDismiss({ open: modelMenuOpen, refs: [menuRef], onDismiss: () => setModelMenuOpen(false) });

  const switchableModels = modelList.length > 0
    ? Array.from(new Set([activeConv.model, ...modelList.map((m) => m.id).filter(Boolean)])).filter(Boolean)
    : activeConv.model
      ? [activeConv.model]
      : [];

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
        <div ref={menuRef} className="relative mt-0.5">
          <button
            type="button"
            disabled={!onQuickSwitchModel || switchableModels.length === 0}
            onClick={() => setModelMenuOpen((open) => !open)}
            aria-expanded={modelMenuOpen}
            aria-haspopup="listbox"
            title={t("aiPage.quickSwitchModelTitle")}
            className="flex max-w-full items-center gap-1 break-words text-xs text-[var(--text-muted)] transition enabled:hover:text-[var(--accent)] disabled:cursor-default"
          >
            <span className="truncate">
              {t("aiPage.modelCaps", { provider: activeProvider?.name || t("aiPage.unknown"), model: activeConv.model })}
            </span>
            {onQuickSwitchModel && switchableModels.length > 0 && (
              <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>
          {modelMenuOpen && (
            <div
              role="listbox"
              aria-label={t("aiPage.quickSwitchModelTitle")}
              data-popover
              className="absolute left-0 top-full mt-1 max-h-64 w-72 overflow-y-auto"
            >
              {switchableModels.map((model) => (
                <button
                  key={model}
                  type="button"
                  role="option"
                  aria-selected={model === activeConv.model}
                  onClick={() => {
                    setModelMenuOpen(false);
                    if (model !== activeConv.model) onQuickSwitchModel?.(model);
                  }}
                  data-menu-item
                  className={model === activeConv.model ? "font-medium !text-[var(--accent)]" : undefined}
                >
                  <span className="min-w-0 truncate font-mono">{model}</span>
                  {model === activeConv.model && (
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="mt-0.5 break-words text-xs text-[var(--text-muted)]">
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
