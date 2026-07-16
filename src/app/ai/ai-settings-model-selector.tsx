"use client";

import type { Dispatch, SetStateAction } from "react";

import { Eye, Video, Music2, File } from "@/components/icons";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/use-locale";

import type { ModelInfo } from "./ai-types";
import type { SettingsFormState } from "./ai-settings-types";

type Props = {
  settingsForm: SettingsFormState;
  setSettingsForm: Dispatch<SetStateAction<SettingsFormState>>;
  modelList: ModelInfo[];
  modelsLoading: boolean;
  modelDropdownOpen: boolean;
  setModelDropdownOpen: Dispatch<SetStateAction<boolean>>;
  modelSearch: string;
  setModelSearch: Dispatch<SetStateAction<string>>;
  currentModelSupportsVision: boolean;
  onRefreshModels: () => void;
};

export function AiSettingsModelSelector({
  settingsForm,
  setSettingsForm,
  modelList,
  modelsLoading,
  modelDropdownOpen,
  setModelDropdownOpen,
  modelSearch,
  setModelSearch,
  currentModelSupportsVision,
  onRefreshModels,
}: Props) {
  const { t } = useI18n();
  const filteredModels = modelList.filter((m) =>
    m.id.toLowerCase().includes(modelSearch.toLowerCase()),
  );

  return (
    <div className="col-span-2 md:col-span-2 relative">
      <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
        {t("aiPage.model")}
        {modelsLoading && (
          <span className="ml-2 text-[var(--color-action)] animate-pulse">
            {t("aiPage.loading")}
          </span>
        )}
      </label>
      <div className="relative mt-1">
        <button
          type="button"
          onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
          className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] transition hover:border-[var(--accent-border)]"
        >
          <span className="truncate flex items-center gap-1.5">
            {settingsForm.model}
            {currentModelSupportsVision && (
              <span className="text-[9px] text-[var(--color-action)] bg-[var(--color-action-bg)]/10 px-1 py-0.5 rounded-lg">
                <Eye size={10} aria-hidden="true" />
              </span>
            )}
          </span>
          <svg
            className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            width="24"
            height="24"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        {modelDropdownOpen && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 flex max-h-60 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]">
            <div className="border-b border-[var(--border-subtle)] p-2">
              <input
                value={modelSearch}
                aria-label={t("aiPage.searchModelAria")}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder={t("aiPage.searchModel")}
                className={cn(UI_INPUT, "px-2 py-1 text-xs")}
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filteredModels.length === 0 && !modelsLoading && (
                <div className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">
                  {t("aiPage.noModels")}{" "}
                  <button
                    type="button"
                    onClick={onRefreshModels}
                    className="ml-2 text-[var(--accent)] hover:text-[var(--accent-hover)]"
                  >
                    {t("aiPage.refresh")}
                  </button>
                </div>
              )}
              {filteredModels.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => {
                    setSettingsForm((f) => ({
                      ...f,
                      model: m.id,
                      enableVision: m.vision ? true : f.enableVision,
                    }));
                    setModelDropdownOpen(false);
                    setModelSearch("");
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-[var(--surface-hover)] ${
                    settingsForm.model === m.id
                      ? "bg-[var(--accent-bg)] text-[var(--accent)]"
                      : "text-[var(--text-primary)]"
                  }`}
                >
                  <span className="truncate flex-1">{m.id}</span>
                  <span className="flex items-center gap-0.5 flex-shrink-0">
                    {(m.capabilities?.vision || m.vision) && (
                      <span
                        className="text-[9px] text-[var(--color-action)]/60"
                        title={t("aiPage.visionCap")}
                      >
                        <Eye size={10} aria-hidden="true" />
                      </span>
                    )}
                    {m.capabilities?.video && (
                      <span
                        className="text-[9px] text-[var(--info)]/60"
                        title={t("aiPage.videoCapSetting")}
                      >
                        <Video size={10} aria-hidden="true" />
                      </span>
                    )}
                    {m.capabilities?.audio && (
                      <span
                        className="text-[9px] text-[var(--accent)]"
                        title={t("aiPage.audioCapSetting")}
                      >
                        <Music2 size={10} aria-hidden="true" />
                      </span>
                    )}
                    {m.capabilities?.document && (
                      <span
                        className="text-[9px] text-[var(--success)]/60"
                        title={t("aiPage.documentCapSetting")}
                      >
                        <File size={10} aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  {m.context_length && (
                    <span className="text-[9px] text-[var(--text-muted)] flex-shrink-0">
                      {(m.context_length / 1000).toFixed(0)}k
                    </span>
                  )}
                  {m.owned_by && (
                    <span className="text-[9px] text-[var(--text-muted)] flex-shrink-0 truncate max-w-[60px]">
                      {m.owned_by}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="border-t border-[var(--border-subtle)] p-2">
              <div className="flex gap-1.5">
                <input
                  value={modelSearch || settingsForm.model}
                  aria-label={t("aiPage.manualModelIdAria")}
                  onChange={(e) => setModelSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && modelSearch.trim()) {
                      setSettingsForm((f) => ({
                        ...f,
                        model: modelSearch.trim(),
                      }));
                      setModelDropdownOpen(false);
                      setModelSearch("");
                    }
                  }}
                  placeholder={t("aiPage.manualModelIdPlaceholder")}
                  className="flex-1 bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                />
                <button
                  onClick={() => {
                    if (modelSearch.trim()) {
                      setSettingsForm((f) => ({
                        ...f,
                        model: modelSearch.trim(),
                      }));
                      setModelDropdownOpen(false);
                      setModelSearch("");
                    }
                  }}
                  className="px-2 py-1 text-[10px]"
                  data-action-button
                  data-variant="ghost"
                >
                  {t("aiPage.apply")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
