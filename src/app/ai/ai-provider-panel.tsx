"use client";

import type { Provider, ModelInfo } from "./ai-types";
import { PROVIDER_TYPES } from "./ai-types";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";
import { useEffect, useMemo, useRef, useState } from "react";
import { ModalShell } from "@/components/modal-shell";
import { Badge, IconButton } from "@/components/ui-primitives";
import { Pencil, Trash2, X } from "@/components/icons";
import { AiProviderFields } from "./ai-provider-fields";

import { ActionButton } from "@/components/action-button";
import { getErrorMessage } from "@/lib/http/error-message";
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
  creatingProvider?: boolean;
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
  creatingProvider = false,
}: ProviderPanelProps) {
  const { t } = useI18n();
  const { addToast } = useToast();
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ProviderFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const mutationRef = useRef(false);
  const probeRef = useRef<AbortController | null>(null);
  const busy = creatingProvider || saving;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Probe results belong to the current credentials and open panel.
    setFetchedModels([]);
    setModelsLoading(false);
    return () => {
      probeRef.current?.abort();
      probeRef.current = null;
    };
  }, [show, provForm.type, provForm.apiKey, provForm.baseUrl]);
  const modelOptions = useMemo(() => {
    const fromFetch = fetchedModels.map((m) => m.id).filter(Boolean);
    const fromForm = provForm.availableModels.split(",").map((m) => m.trim()).filter(Boolean);
    return Array.from(new Set([...fromFetch, ...fromForm]));
  }, [fetchedModels, provForm.availableModels]);

  const fetchProviderModels = async () => {
    if (probeRef.current) return;
    const baseUrl = provForm.baseUrl.trim();
    if (!provForm.apiKey.trim()) {
      addToast("error", t("aiPage.apiKeyRequiredHint"));
      return;
    }
    setModelsLoading(true);
    const probe = new AbortController();
    probeRef.current = probe;
    try {
      const data = await csrfFetch("/api/ai/models/probe", {
        method: "POST",
        signal: probe.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: provForm.type,
          apiKey: provForm.apiKey,
          ...(baseUrl ? { baseUrl } : {}),
        }),
      });
      if (probe.signal.aborted || probeRef.current !== probe) return;
      const models = Array.isArray(data.models) ? data.models as ModelInfo[] : [];
      setFetchedModels(models);
      const ids = models.map((m) => m.id).filter(Boolean);
      setProvForm((f) => ({
        ...f,
        availableModels: ids.join(","),
        defaultModel: ids.includes(f.defaultModel) ? f.defaultModel : ids[0] || f.defaultModel,
      }));
      addToast("success", ids.length > 0 ? t("aiPage.modelsFetched", { count: ids.length }) : t("aiPage.modelsFetchedEmpty"));
    } catch (e: unknown) {
      if (probe.signal.aborted || probeRef.current !== probe) return;
      addToast("error", getErrorMessage(e, t("aiPage.modelsFetchFailed")));
    } finally {
      if (probeRef.current === probe) {
        probeRef.current = null;
        setModelsLoading(false);
      }
    }
  };

  const startEditing = (provider: Provider) => {
    probeRef.current?.abort();
    probeRef.current = null;
    setModelsLoading(false);
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
    if (!editingProviderId || !editForm || mutationRef.current) return;
    mutationRef.current = true;
    setSaving(true);
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
      addToast("error", getErrorMessage(e, t("aiPage.providerUpdateFailed")));
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  };

  if (!show) return null;

  return (
    <ModalShell
      open={show}
      onClose={onClose}
      labelledBy="ai-provider-panel-title"
      busy={busy}
      panelClassName="flex max-h-[calc(100dvh-2rem)] w-full min-w-0 max-w-xl flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--modal-bg)] shadow-[var(--shadow-lg)]"
    >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <h3 id="ai-provider-panel-title" className="text-sm font-semibold text-[var(--text-primary)]">{t("aiPage.providerPanelTitle")}</h3>
          <IconButton
            onClick={onClose}
            disabled={busy}
            className="h-10 w-10 shrink-0"
            label={t("aiPage.closeProviderAria")}
          >
            <X size={18} aria-hidden />
          </IconButton>
        </div>

        <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <fieldset disabled={busy} className="min-w-0 space-y-5">
          {providers.length > 0 && (
            <div className="divide-y divide-[var(--border)]">
              <h4 className="text-xs text-[var(--text-muted)] uppercase ">{t("aiPage.addedProviders")}</h4>
              {providers.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-[var(--text-primary)] font-medium">{p.name}</span>
                      <Badge tone="neutral">
                        {PROVIDER_TYPES[p.type] || p.type}
                      </Badge>
                      {p.isDefault && <Badge tone="accent">{t("common.default")}</Badge>}
                      {!p.enabled && <Badge tone="danger">{t("aiPage.disabledBadge")}</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs leading-5 text-[var(--text-muted)]">{p.baseUrl} · {p.defaultModel}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 max-sm:justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        if (mutationRef.current) return;
                        mutationRef.current = true;
                        setSaving(true);
                        try {
                          await csrfFetch(`/api/ai/providers/${p.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ enabled: !p.enabled }),
                          });
                          onRefreshProviders();
                        } catch (e: unknown) {
                          addToast("error", getErrorMessage(e, t("aiPage.providerUpdateFailed")));
                        } finally {
                          mutationRef.current = false;
                          setSaving(false);
                        }
                      }}
                      className={`min-h-9 rounded-lg px-2 text-xs font-medium transition ${p.enabled ? "text-[var(--warning)] hover:bg-[var(--warning-bg)]" : "text-[var(--success)] hover:bg-[var(--success-bg)]"}`}
                    >
                      {p.enabled ? t("aiPage.disableAction") : t("aiPage.enableAction")}
                    </button>
                    <IconButton
                      onClick={() => startEditing(p)}
                      tone="accent"
                      label={t("aiPage.editProviderAria", { name: p.name })}
                    >
                      <Pencil size={16} aria-hidden />
                    </IconButton>
                    <IconButton
                      onClick={() => onDeleteProvider(p.id)}
                      tone="danger"
                      label={t("aiPage.deleteProviderAria2", { name: p.name })}
                    >
                      <Trash2 size={16} aria-hidden />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}

          {editForm ? (
            <form className="space-y-4 border-t border-[var(--border)] pt-4" onSubmit={(event) => { event.preventDefault(); void saveEditing(); }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t("aiPage.editProviderTitle")}</h4>
                <ActionButton type="button" variant="ghost" onClick={cancelEditing}>{t("aiPage.cancelEditing")}</ActionButton>
              </div>
              <AiProviderFields form={editForm} editing onChange={(patch) => setEditForm((form) => form ? { ...form, ...patch } : form)} />
              <ActionButton type="submit" disabled={busy} className="w-full">{t("common.saveChanges")}</ActionButton>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onCreateProvider(); }}>
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t("aiPage.addNewProvider")}</h4>
              <AiProviderFields form={provForm} models={modelOptions} onChange={(patch) => setProvForm((form) => ({ ...form, ...patch }))} />
              <div className="space-y-2 border-y border-[var(--border)] py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-[var(--text-secondary)]">{t("aiPage.modelListLabel")}</span>
                  <ActionButton type="button" variant="secondary" onClick={fetchProviderModels} disabled={modelsLoading}>
                    {modelsLoading ? t("aiPage.fetchingModels") : t("aiPage.fetchModels")}
                  </ActionButton>
                </div>
                {modelOptions.length > 0 && <p className="max-h-24 overflow-y-auto break-words text-xs leading-5 text-[var(--text-secondary)]">{modelOptions.slice(0, 20).join(", ")}{modelOptions.length > 20 ? t("aiPage.modelsMore", { count: modelOptions.length }) : ""}</p>}
              </div>
              <ActionButton type="submit" disabled={busy} className="w-full">
                {creatingProvider ? t("aiPage.processing") : t("aiPage.addProviderButton")}
              </ActionButton>
            </form>
          )}
          </fieldset>
        </div>
    </ModalShell>
  );
}
