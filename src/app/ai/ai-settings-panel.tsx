"use client";

import type { ModelInfo } from "./ai-types";
import { useI18n } from "@/lib/i18n/use-locale";
import { Eye, Video, Music2, File } from "@/components/icons";

interface SettingsFormState {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  enableVision: boolean;
  hostingEnabled: boolean;
}

interface SettingsPanelProps {
  show: boolean;
  settingsForm: SettingsFormState;
  setSettingsForm: React.Dispatch<React.SetStateAction<SettingsFormState>>;
  modelList: ModelInfo[];
  modelsLoading: boolean;
  modelDropdownOpen: boolean;
  setModelDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  modelSearch: string;
  setModelSearch: React.Dispatch<React.SetStateAction<string>>;
  currentModelSupportsVision: boolean;
  onSaveSettings: () => void;
  onRefreshModels: () => void;
}

export function AiSettingsPanel({
  show,
  settingsForm,
  setSettingsForm,
  modelList,
  modelsLoading,
  modelDropdownOpen,
  setModelDropdownOpen,
  modelSearch,
  setModelSearch,
  currentModelSupportsVision,
  onSaveSettings,
  onRefreshModels,
}: SettingsPanelProps) {
  const { t } = useI18n();
  if (!show) return null;

  const filteredModels = modelList.filter((m) =>
    m.id.toLowerCase().includes(modelSearch.toLowerCase()),
  );

  return (
    <div className="max-h-[50vh] overflow-y-auto border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_96%,transparent)] p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Model selector */}
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
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-border)] focus:outline-none"
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
                {/* Manual model input fallback */}
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
                      className="px-2 py-1 text-[10px]" data-action-button data-variant="ghost"
                    >
                      {t("aiPage.apply")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Temperature slider */}
        <div>
          <label
            htmlFor="ai-setting-temperature"
            className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider"
          >
            Temperature{" "}
            <span className="text-[var(--color-action)]/70">
              {settingsForm.temperature.toFixed(2)}
            </span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="ai-setting-temperature"
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={settingsForm.temperature}
              onChange={(e) =>
                setSettingsForm((f) => ({
                  ...f,
                  temperature: parseFloat(e.target.value),
                }))
              }
              className="flex-1 h-1.5 bg-[var(--surface-elevated)] rounded-full appearance-none cursor-pointer accent-[var(--color-action)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-action-bg)]"
            />
          </div>
        </div>

        {/* Max Tokens */}
        <div>
          <label
            htmlFor="ai-setting-max-tokens"
            className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider"
          >
            Max Tokens
          </label>
          <select
            id="ai-setting-max-tokens"
            value={settingsForm.maxTokens}
            onChange={(e) =>
              setSettingsForm((f) => ({
                ...f,
                maxTokens: parseInt(e.target.value),
              }))
            }
            className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
          >
            {[512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 128000].map(
              (v) => (
                <option key={v} value={v}>
                  {v.toLocaleString()}
                </option>
              ),
            )}
          </select>
        </div>

        {/* Top P slider */}
        <div>
          <label
            htmlFor="ai-setting-top-p"
            className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider"
          >
            Top P{" "}
            <span className="text-[var(--color-action)]/70">
              {settingsForm.topP.toFixed(2)}
            </span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="ai-setting-top-p"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settingsForm.topP}
              onChange={(e) =>
                setSettingsForm((f) => ({
                  ...f,
                  topP: parseFloat(e.target.value),
                }))
              }
              className="flex-1 h-1.5 bg-[var(--surface-elevated)] rounded-full appearance-none cursor-pointer accent-[var(--color-action)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-action-bg)]"
            />
          </div>
        </div>

        {/* Frequency Penalty slider */}
        <div>
          <label
            htmlFor="ai-setting-freq-pen"
            className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider"
          >
            {t("aiPage.frequencyPenalty")}{" "}
            <span className="text-[var(--color-action)]/70">
              {settingsForm.frequencyPenalty.toFixed(2)}
            </span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="ai-setting-freq-pen"
              type="range"
              min={-2}
              max={2}
              step={0.01}
              value={settingsForm.frequencyPenalty}
              onChange={(e) =>
                setSettingsForm((f) => ({
                  ...f,
                  frequencyPenalty: parseFloat(e.target.value),
                }))
              }
              className="flex-1 h-1.5 bg-[var(--surface-elevated)] rounded-full appearance-none cursor-pointer accent-[var(--color-action)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-action-bg)]"
            />
          </div>
        </div>

        {/* Presence Penalty slider */}
        <div>
          <label
            htmlFor="ai-setting-pres-pen"
            className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider"
          >
            {t("aiPage.presencePenalty")}{" "}
            <span className="text-[var(--color-action)]/70">
              {settingsForm.presencePenalty.toFixed(2)}
            </span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="ai-setting-pres-pen"
              type="range"
              min={-2}
              max={2}
              step={0.01}
              value={settingsForm.presencePenalty}
              onChange={(e) =>
                setSettingsForm((f) => ({
                  ...f,
                  presencePenalty: parseFloat(e.target.value),
                }))
              }
              className="flex-1 h-1.5 bg-[var(--surface-elevated)] rounded-full appearance-none cursor-pointer accent-[var(--color-action)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-action-bg)]"
            />
          </div>
        </div>

        {/* Vision toggle */}
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settingsForm.enableVision}
              onChange={(e) =>
                setSettingsForm((f) => ({
                  ...f,
                  enableVision: e.target.checked,
                }))
              }
              className="rounded-lg border-[var(--border)] bg-[var(--input-bg)] text-[var(--color-action)] focus:ring-[var(--color-action-ring)]"
            />
            <span className="text-xs text-[var(--text-secondary)]">
              {t("aiPage.visionToggle")}
              {currentModelSupportsVision && (
                <span className="text-[9px] text-[var(--color-action)]/60 ml-1">
                  {t("aiPage.recommended")}
                </span>
              )}
            </span>
          </label>
        </div>

        {/* Hosting (AI托管) toggle */}
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settingsForm.hostingEnabled}
              onChange={(e) =>
                setSettingsForm((f) => ({
                  ...f,
                  hostingEnabled: e.target.checked,
                }))
              }
              className="rounded-lg border-[var(--border)] bg-[var(--input-bg)] text-[var(--warning)] focus:ring-[var(--warning-border)]"
            />
            <span className="text-xs text-[var(--text-secondary)]">
              {t("aiPage.hostedMode")}
              <span className="text-[9px] text-[var(--warning)]/60 ml-1">
                {t("aiPage.hostedHint")}
              </span>
            </span>
          </label>
        </div>

        {/* Save button */}
        <div className="flex items-end gap-2">
          <button
            onClick={onSaveSettings}
            data-action-button data-variant="ghost" className="h-7 px-3 text-xs"
          >
            {t("aiPage.saveSettings")}
          </button>
        </div>
      </div>

      {/* System prompt */}
      <div className="mt-3">
        <label
          className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider"
          htmlFor="ai-setting-system-prompt"
        >
          {t("aiPage.systemPromptLabel")}
        </label>
        <textarea
          id="ai-setting-system-prompt"
          value={settingsForm.systemPrompt}
          onChange={(e) =>
            setSettingsForm((f) => ({ ...f, systemPrompt: e.target.value }))
          }
          rows={2}
          placeholder={t("aiPage.systemPromptPlaceholder")}
          className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:border-[var(--color-action-border)]/30"
        />
      </div>
    </div>
  );
}
