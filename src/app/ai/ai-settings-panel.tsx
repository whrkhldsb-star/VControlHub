"use client";

import type { ModelInfo } from "./ai-types";
import { useI18n } from "@/lib/i18n/use-locale";

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
    m.id.toLowerCase().includes(modelSearch.toLowerCase())
  );

  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface-subtle)] p-4 max-h-[50vh] overflow-y-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Model selector */}
        <div className="col-span-2 md:col-span-2 relative">
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
            {t("aiPage.model")}
            {modelsLoading && <span className="ml-2 text-cyan-400 animate-pulse">{t("aiPage.loading")}</span>}
          </label>
          <div className="relative mt-1">
            <button
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              className="w-full flex items-center justify-between bg-black/30 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:border-cyan-400/30 transition"
            >
              <span className="truncate flex items-center gap-1.5">
                {settingsForm.model}
                {currentModelSupportsVision && (
                  <span className="text-[9px] text-cyan-400 bg-cyan-400/10 px-1 py-0.5 rounded-lg">👁</span>
                )}
              </span>
              <svg className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"> <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /> </svg> </button> {modelDropdownOpen && ( <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl max-h-60 overflow-hidden flex flex-col"> <div className="p-2 border-b border-[var(--border)]/5"> <input value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder={t("aiPage.searchModel")} aria-label={t("aiPage.searchModelAria")} className="w-full bg-black/30 border border-[var(--border)]/5 rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] placeholder-slate-600 focus:outline-none focus:border-cyan-400/30" autoFocus /> </div> <div className="overflow-y-auto max-h-48"> {filteredModels.length === 0 && !modelsLoading && ( <div className="px-3 py-4 text-xs text-[var(--text-muted)] text-center"> {t("aiPage.noModels")} <button onClick={onRefreshModels} className="ml-2 text-cyan-400 hover:text-cyan-300 light:hover:text-cyan-700" > {t("aiPage.refresh")} </button> </div> )} {filteredModels.map((m) => ( <button key={m.id} onClick={() => { setSettingsForm((f) => ({ ...f, model: m.id, enableVision: m.vision ? true : f.enableVision, })); setModelDropdownOpen(false); setModelSearch(""); }} className={`w-full text-left px-3 py-2 text-xs hover:bg-[var(--surface)]/[0.04] transition flex items-center gap-2 ${
                        settingsForm.model === m.id ? "text-cyan-300 bg-cyan-400/[0.06]" : "text-[var(--text-primary)]"
                      }`}
                    >
                      <span className="truncate flex-1">{m.id}</span>
                      <span className="flex items-center gap-0.5 flex-shrink-0">
                        {(m.capabilities?.vision || m.vision) && (
                          <span className="text-[9px] text-cyan-400/60" title={t("aiPage.visionCap")}>👁</span>
                        )}
                        {m.capabilities?.video && (
                          <span className="text-[9px] text-blue-400/60" title={t("aiPage.videoCapSetting")}>🎬</span>
                        )}
                        {m.capabilities?.audio && (
                          <span className="text-[9px] text-purple-400/60" title={t("aiPage.audioCapSetting")}>🎵</span>
                        )}
                        {m.capabilities?.document && (
                          <span className="text-[9px] text-green-400/60" title={t("aiPage.documentCapSetting")}>📑</span>
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
                <div className="border-t border-[var(--border)]/5 p-2">
                  <div className="flex gap-1.5">
                    <input
                      value={modelSearch || settingsForm.model}
                      onChange={(e) => setModelSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && modelSearch.trim()) {
                          setSettingsForm((f) => ({ ...f, model: modelSearch.trim() }));
                          setModelDropdownOpen(false);
                          setModelSearch("");
                        }
                      }}
                      placeholder={t("aiPage.manualModelIdPlaceholder")}
                      aria-label={t("aiPage.manualModelIdAria")}
                      className="flex-1 bg-black/30 border border-[var(--border)]/5 rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] placeholder-slate-600 focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        if (modelSearch.trim()) {
                          setSettingsForm((f) => ({ ...f, model: modelSearch.trim() }));
                          setModelDropdownOpen(false);
                          setModelSearch("");
                        }
                      }}
                      className="px-2 py-1 text-[10px] bg-cyan-500/20 text-cyan-300 rounded-lg hover:bg-cyan-500/30"
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
          <label htmlFor="ai-setting-temperature" className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
            Temperature <span className="text-cyan-400/70">{settingsForm.temperature.toFixed(2)}</span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="ai-setting-temperature"
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={settingsForm.temperature}
              onChange={(e) => setSettingsForm((f) => ({ ...f, temperature: parseFloat(e.target.value) }))}
              className="flex-1 h-1.5 bg-[var(--surface)]/5 rounded-full appearance-none cursor-pointer accent-cyan-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400"
            />
          </div>
        </div>

        {/* Max Tokens */}
        <div>
          <label htmlFor="ai-setting-max-tokens" className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
            Max Tokens
          </label>
          <select
            id="ai-setting-max-tokens"
            value={settingsForm.maxTokens}
            onChange={(e) => setSettingsForm((f) => ({ ...f, maxTokens: parseInt(e.target.value) }))}
            className="w-full mt-1 bg-black/30 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
          >
            {[512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 128000].map((v) => (
              <option key={v} value={v}>{v.toLocaleString()}</option>
            ))}
          </select>
        </div>

        {/* Top P slider */}
        <div>
          <label htmlFor="ai-setting-top-p" className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
            Top P <span className="text-cyan-400/70">{settingsForm.topP.toFixed(2)}</span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="ai-setting-top-p"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settingsForm.topP}
              onChange={(e) => setSettingsForm((f) => ({ ...f, topP: parseFloat(e.target.value) }))}
              className="flex-1 h-1.5 bg-[var(--surface)]/5 rounded-full appearance-none cursor-pointer accent-cyan-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400"
            />
          </div>
        </div>

        {/* Frequency Penalty slider */}
        <div>
          <label htmlFor="ai-setting-freq-pen" className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
            {t("aiPage.frequencyPenalty")} <span className="text-cyan-400/70">{settingsForm.frequencyPenalty.toFixed(2)}</span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="ai-setting-freq-pen"
              type="range"
              min={-2}
              max={2}
              step={0.01}
              value={settingsForm.frequencyPenalty}
              onChange={(e) => setSettingsForm((f) => ({ ...f, frequencyPenalty: parseFloat(e.target.value) }))}
              className="flex-1 h-1.5 bg-[var(--surface)]/5 rounded-full appearance-none cursor-pointer accent-cyan-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400"
            />
          </div>
        </div>

        {/* Presence Penalty slider */}
        <div>
          <label htmlFor="ai-setting-pres-pen" className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
            {t("aiPage.presencePenalty")} <span className="text-cyan-400/70">{settingsForm.presencePenalty.toFixed(2)}</span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="ai-setting-pres-pen"
              type="range"
              min={-2}
              max={2}
              step={0.01}
              value={settingsForm.presencePenalty}
              onChange={(e) => setSettingsForm((f) => ({ ...f, presencePenalty: parseFloat(e.target.value) }))}
              className="flex-1 h-1.5 bg-[var(--surface)]/5 rounded-full appearance-none cursor-pointer accent-cyan-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400"
            />
          </div>
        </div>

        {/* Vision toggle */}
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settingsForm.enableVision}
              onChange={(e) => setSettingsForm((f) => ({ ...f, enableVision: e.target.checked }))}
              className="rounded-lg border-[var(--border)] bg-black/30 text-cyan-400 focus:ring-cyan-400/30"
            />
            <span className="text-xs text-[var(--text-secondary)]">
              {t("aiPage.visionToggle")}
              {currentModelSupportsVision && (
                <span className="text-[9px] text-cyan-400/60 ml-1">{t("aiPage.recommended")}</span>
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
 onChange={(e) => setSettingsForm((f) => ({ ...f, hostingEnabled: e.target.checked }))}
 className="rounded-lg border-[var(--border)] bg-black/30 text-amber-400 focus:ring-amber-400/30"
 />
 <span className="text-xs text-[var(--text-secondary)]">
 {t("aiPage.hostedMode")}
 <span className="text-[9px] text-amber-400/60 ml-1">{t("aiPage.hostedHint")}</span>
 </span>
 </label>
 </div>

 {/* Save button */}
        <div className="flex items-end gap-2">
          <button
            onClick={onSaveSettings}
            className="h-7 px-3 rounded-lg bg-cyan-500/20 text-cyan-300 text-xs font-medium hover:bg-cyan-500/30 transition"
          >
            {t("aiPage.saveSettings")}
          </button>
        </div>
      </div>

      {/* System prompt */}
      <div className="mt-3">
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider" htmlFor="ai-setting-system-prompt">{t("aiPage.systemPromptLabel")}</label>
        <textarea
          id="ai-setting-system-prompt"
          value={settingsForm.systemPrompt}
          onChange={(e) => setSettingsForm((f) => ({ ...f, systemPrompt: e.target.value }))}
          rows={2}
          placeholder={t("aiPage.systemPromptPlaceholder")}
          className="w-full mt-1 bg-black/30 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-slate-600 resize-none focus:outline-none focus:border-cyan-400/30"
        />
      </div>
    </div>
  );
}
