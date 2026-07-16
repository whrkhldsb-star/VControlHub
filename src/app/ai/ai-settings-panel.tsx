"use client";

import type { SettingsPanelProps } from "./ai-settings-types";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { AiSettingsModelSelector } from "./ai-settings-model-selector";

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

  return (
    <div className="max-h-[50vh] overflow-y-auto border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_96%,transparent)] p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <AiSettingsModelSelector
          settingsForm={settingsForm}
          setSettingsForm={setSettingsForm}
          modelList={modelList}
          modelsLoading={modelsLoading}
          modelDropdownOpen={modelDropdownOpen}
          setModelDropdownOpen={setModelDropdownOpen}
          modelSearch={modelSearch}
          setModelSearch={setModelSearch}
          currentModelSupportsVision={currentModelSupportsVision}
          onRefreshModels={onRefreshModels}
        />

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
            data-action-button
            data-variant="ghost"
            className="h-7 px-3 text-xs"
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
          className={cn(UI_INPUT, "mt-1 resize-none text-xs")}
        />
      </div>
    </div>
  );
}
