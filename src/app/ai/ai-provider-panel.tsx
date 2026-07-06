"use client";

import type { Provider, ModelInfo } from "./ai-types";
import { PROVIDER_TYPES, COMMON_BASE_URLS } from "./ai-types";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";
import { useMemo, useState } from "react";

export interface ProviderFormState {
  name: string;
  type: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  availableModels: string;
  isDefault: boolean;
}

interface ProviderPanelProps {
  show: boolean;
  providers: Provider[];
  provForm: ProviderFormState;
  onClose: () => void;
  onCreateProvider: () => void;
  onDeleteProvider: (id: string) => void;
  onRefreshProviders: () => void;
  setProvForm: React.Dispatch<React.SetStateAction<ProviderFormState>>;
}

export function AiProviderPanel({
  show,
  providers,
  provForm,
  onClose,
  onCreateProvider,
  onDeleteProvider,
  onRefreshProviders,
  setProvForm,
}: ProviderPanelProps) {
  const { t } = useI18n();
  const { addToast } = useToast();
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ProviderFormState | null>(null);
  const modelOptions = useMemo(() => {
    const fromFetch = fetchedModels.map((m) => m.id).filter(Boolean);
    const fromForm = provForm.availableModels.split(",").map((m) => m.trim()).filter(Boolean);
    return Array.from(new Set([...fromFetch, ...fromForm]));
  }, [fetchedModels, provForm.availableModels]);

  const fetchProviderModels = async () => {
    const baseUrl = provForm.baseUrl.trim();
    if (!provForm.apiKey.trim()) {
      addToast("error", t("aiPage.apiKeyRequiredHint"));
      return;
    }
    setModelsLoading(true);
    try {
      const data = await csrfFetch("/api/ai/models/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: provForm.type,
          apiKey: provForm.apiKey,
          ...(baseUrl ? { baseUrl } : {}),
        }),
      });
      const models = Array.isArray(data.models) ? data.models as ModelInfo[] : [];
      setFetchedModels(models);
      const ids = models.map((m) => m.id).filter(Boolean);
      setProvForm((f) => ({
        ...f,
        availableModels: ids.join(","),
        defaultModel: ids.includes(f.defaultModel) ? f.defaultModel : ids[0] || f.defaultModel,
      }));
      addToast("success", ids.length > 0 ? t("aiPage.modelsFetched").replace("{count}", String(ids.length)) : t("aiPage.modelsFetchedEmpty"));
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : t("aiPage.modelsFetchFailed"));
    } finally {
      setModelsLoading(false);
    }
  };

  const startEditing = (provider: Provider) => {
    setEditingProviderId(provider.id);
    setEditForm({
      name: provider.name,
      type: provider.type,
      apiKey: "",
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      availableModels: provider.availableModels,
      isDefault: provider.isDefault,
    });
  };

  const cancelEditing = () => {
    setEditingProviderId(null);
    setEditForm(null);
  };

  const saveEditing = async () => {
    if (!editingProviderId || !editForm) return;
    const availableModels = editForm.availableModels
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    const patchBody: Record<string, string | boolean | string[]> = {
      name: editForm.name.trim(),
      type: editForm.type,
      baseUrl: editForm.baseUrl.trim(),
      defaultModel: editForm.defaultModel.trim(),
      availableModels,
      isDefault: editForm.isDefault,
    };
    if (editForm.apiKey.trim()) patchBody.apiKey = editForm.apiKey.trim();
    try {
      await csrfFetch(`/api/ai/providers/${editingProviderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      addToast("success", t("aiPage.providerUpdated"));
      cancelEditing();
      onRefreshProviders();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : t("aiPage.providerUpdateFailed"));
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm max-sm:items-end">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-provider-panel-title"
        className="w-full max-w-lg max-sm:max-w-none max-sm:rounded-b-none bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[var(--card-border)] flex items-center justify-between">
          <h3 id="ai-provider-panel-title" className="text-sm font-semibold text-[var(--text-primary)]">{t("aiPage.providerPanelTitle")}</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition"
            aria-label={t("aiPage.closeProviderAria")}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[min(70vh,640px)] max-sm:max-h-[80vh] overflow-y-auto">
          {providers.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{t("aiPage.addedProviders")}</h4>
              {providers.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--input-bg)] border border-[var(--border)]/10 max-sm:flex-col max-sm:items-stretch">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-[var(--text-primary)] font-medium">{p.name}</span>
                      <span className="text-[10px] text-[var(--text-muted)] bg-[var(--surface)]/10 px-1.5 py-0.5 rounded-lg">
                        {PROVIDER_TYPES[p.type] || p.type}
                      </span>
                      {p.isDefault && <span className="text-[10px] text-[var(--color-action)] bg-[var(--color-action-bg)]/10 px-1.5 py-0.5 rounded-lg">{t("common.default")}</span>}
                      {!p.enabled && <span className="text-[10px] text-[var(--danger)] bg-[var(--danger-bg)] px-1.5 py-0.5 rounded-lg">{t("aiPage.disabledBadge")}</span>}
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{p.baseUrl} · {p.defaultModel}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 max-sm:justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await csrfFetch(`/api/ai/providers/${p.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ enabled: !p.enabled }),
                          });
                          onRefreshProviders();
                        } catch (e: unknown) {
                          addToast("error", e instanceof Error ? e.message : t("aiPage.providerUpdateFailed"));
                        }
                      }}
                      className={`text-xs transition ${p.enabled ? "text-[var(--warning)]/60 hover:text-[var(--warning)]" : "text-[var(--success)]/60 hover:text-[var(--success)]"}`}
                    >
                      {p.enabled ? t("aiPage.disableAction") : t("aiPage.enableAction")}
                    </button>
                    <button
                      onClick={() => startEditing(p)}
                      className="text-xs text-[var(--color-action)]/60 hover:text-[var(--color-action)] transition"
                      aria-label={t("aiPage.editProviderAria").replace("{name}", p.name)}
                    >
                      {t("aiPage.editAction")}
                    </button>
                    <button
                      onClick={() => onDeleteProvider(p.id)}
                      className="text-xs text-[var(--danger)]/60 hover:text-[var(--danger)] transition"
                      aria-label={t("aiPage.deleteProviderAria2").replace("{name}", p.name)}
                    >
                      {t("aiPage.deleteAction")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {editForm ? (
            <div data-tone="cyan" className="space-y-3 rounded-xl border border-[var(--color-action-border)]/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">{t("aiPage.editProviderTitle")}</h4>
                <button type="button" onClick={cancelEditing} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-secondary)] light:hover:text-[var(--text-disabled)]">{t("aiPage.cancelEditing")}</button>
              </div>
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]" htmlFor="ai-provider-edit-name">{t("aiPage.nameLabel")}</label>
                  <input id="ai-provider-edit-name" value={editForm.name} onChange={(e) => setEditForm((f) => f ? ({ ...f, name: e.target.value }) : f)} className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)]" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]" htmlFor="ai-provider-edit-type">{t("aiPage.typeLabel")}</label>
                  <select id="ai-provider-edit-type" value={editForm.type} onChange={(e) => setEditForm((f) => f ? ({ ...f, type: e.target.value, baseUrl: COMMON_BASE_URLS[e.target.value] || f.baseUrl }) : f)} className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)]">
                    {Object.entries(PROVIDER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="col-span-2 max-sm:col-span-1">
                  <label className="text-[10px] text-[var(--text-muted)]" htmlFor="ai-provider-edit-key">API Key</label>
                  <input id="ai-provider-edit-key" type="password" value={editForm.apiKey} onChange={(e) => setEditForm((f) => f ? ({ ...f, apiKey: e.target.value }) : f)} placeholder={t("aiPage.apiKeyPlaceholder")} className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] font-mono" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]" htmlFor="ai-provider-edit-base-url">Base URL</label>
                  <input id="ai-provider-edit-base-url" value={editForm.baseUrl} onChange={(e) => setEditForm((f) => f ? ({ ...f, baseUrl: e.target.value }) : f)} className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)]" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]" htmlFor="ai-provider-edit-default-model">{t("aiPage.defaultModelLabel")}</label>
                  <input id="ai-provider-edit-default-model" aria-label={t("aiPage.defaultModelLabel")} value={editForm.defaultModel} onChange={(e) => setEditForm((f) => f ? ({ ...f, defaultModel: e.target.value }) : f)} className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)]" />
                </div>
                <label className="flex items-center gap-2 col-span-2 max-sm:col-span-1 cursor-pointer">
                  <input type="checkbox" checked={editForm.isDefault} onChange={(e) => setEditForm((f) => f ? ({ ...f, isDefault: e.target.checked }) : f)} className="rounded-lg border-[var(--border)] bg-[var(--input-bg)] text-[var(--color-action)] focus:ring-[var(--color-action-ring)]" />
                  <span className="text-xs text-[var(--text-secondary)]">{t("common.setAsDefault")}</span>
                </label>
              </div>
              <button type="button" onClick={saveEditing} className="w-full h-9 rounded-xl bg-[var(--color-action)]/20 text-[var(--color-action)] text-sm font-medium hover:bg-[var(--color-action)]/30 transition">{t("common.saveChanges")}</button>
            </div>
          ) : (
            <div className="space-y-3">
              <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{t("aiPage.addNewProvider")}</h4>
              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]" htmlFor="ai-provider-name">{t("aiPage.nameLabel")}</label>
                  <input id="ai-provider-name" value={provForm.name} onChange={(e) => setProvForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("aiPage.providerNamePlaceholder")} className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)]" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]" htmlFor="ai-provider-type">{t("aiPage.typeLabel")}</label>
                  <select id="ai-provider-type" value={provForm.type} onChange={(e) => {
                    const t = e.target.value;
                    setFetchedModels([]);
                    setProvForm((f) => ({ ...f, type: t, baseUrl: COMMON_BASE_URLS[t] || f.baseUrl, availableModels: "" }));
                  }} className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)]">
                    {Object.entries(PROVIDER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="col-span-2 max-sm:col-span-1">
                  <label className="text-[10px] text-[var(--text-muted)]" htmlFor="ai-provider-key">API Key</label>
                  <input id="ai-provider-key" type="password" value={provForm.apiKey} onChange={(e) => setProvForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder="sk-..." className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] font-mono" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]" htmlFor="ai-provider-base-url">Base URL</label>
                  <input id="ai-provider-base-url" value={provForm.baseUrl} onChange={(e) => setProvForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://api.openai.com/v1" className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)]" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-muted)]" htmlFor="ai-provider-default-model">{t("aiPage.defaultModelLabel")}</label>
                  {modelOptions.length > 0 ? (
                    <select id="ai-provider-default-model" aria-label={t("aiPage.defaultModelLabel")} value={provForm.defaultModel || modelOptions[0]} onChange={(e) => setProvForm((f) => ({ ...f, defaultModel: e.target.value }))} className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)]">
                      {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
                  ) : (
                    <input id="ai-provider-default-model" aria-label={t("aiPage.defaultModelLabel")} value={provForm.defaultModel} onChange={(e) => setProvForm((f) => ({ ...f, defaultModel: e.target.value }))} placeholder={t("aiPage.modelListHint")} className="w-full mt-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)]" />
                  )}
                </div>
                <div className="col-span-2 max-sm:col-span-1 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
                    <div>
                      <div className="text-[10px] text-[var(--text-secondary)]">{t("aiPage.modelListLabel")}</div>
                      <p className="text-[11px] text-[var(--text-muted)]">{t("aiPage.modelListHint")}</p>
                    </div>
                    <button type="button" onClick={fetchProviderModels} disabled={modelsLoading} className="h-8 px-3 rounded-lg bg-[var(--color-action)]/20 text-[var(--color-action)] text-xs font-medium hover:bg-[var(--color-action)]/30 transition disabled:opacity-50">
                      {modelsLoading ? t("aiPage.fetchingModels") : t("aiPage.fetchModels")}
                    </button>
                  </div>
                  {modelOptions.length > 0 && <div className="max-h-24 overflow-y-auto rounded-lg bg-[var(--input-bg)] p-2 text-[11px] text-[var(--text-secondary)]">{modelOptions.slice(0, 20).join("、")}{modelOptions.length > 20 ? t("aiPage.modelsMore").replace("{count}", String(modelOptions.length)) : ""}</div>}
                </div>
                <label className="flex items-center gap-2 col-span-2 max-sm:col-span-1 cursor-pointer">
                  <input type="checkbox" checked={provForm.isDefault} onChange={(e) => setProvForm((f) => ({ ...f, isDefault: e.target.checked }))} className="rounded-lg border-[var(--border)] bg-[var(--input-bg)] text-[var(--color-action)] focus:ring-[var(--color-action-ring)]" />
                  <span className="text-xs text-[var(--text-secondary)]">{t("common.setAsDefault")}</span>
                </label>
              </div>
              <button onClick={onCreateProvider} className="w-full h-9 rounded-xl bg-[var(--color-action)]/20 text-[var(--color-action)] text-sm font-medium hover:bg-[var(--color-action)]/30 transition">{t("aiPage.addProviderButton")}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
