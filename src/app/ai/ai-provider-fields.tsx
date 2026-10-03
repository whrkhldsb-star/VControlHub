"use client";

import { CheckboxField, Chip, CONTROL_CLASS, FormField, Input } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import type { ProviderFormState } from "./ai-provider-panel";
import { COMMON_BASE_URLS, PROVIDER_PRESETS, PROVIDER_TYPES } from "./ai-types";

export function AiProviderFields({ form, onChange, editing = false, models = [] }: {
  form: ProviderFormState;
  onChange: (patch: Partial<ProviderFormState>) => void;
  editing?: boolean;
  models?: string[];
}) {
  const { t } = useI18n();
  const prefix = editing ? "ai-provider-edit" : "ai-provider";

  const applyPreset = (preset: (typeof PROVIDER_PRESETS)[number]) => {
    onChange({
      name: preset.name,
      type: preset.type,
      baseUrl: preset.baseUrl,
      defaultModel: preset.models[0] ?? "",
      availableModels: preset.models.join(","),
    });
  };

  const presetLabel = (preset: (typeof PROVIDER_PRESETS)[number]) => {
    const key = `aiPage.preset.${preset.id}`;
    const translated = t(key);
    return translated === key ? preset.name : translated;
  };

  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {!editing && (
      <div className="sm:col-span-2">
        <p className="mb-2 text-xs text-[var(--text-muted)]">{t("aiPage.presetHint")}</p>
        <div className="flex flex-wrap gap-2">
          {PROVIDER_PRESETS.map((preset) => {
            const active = form.baseUrl === preset.baseUrl && form.type === preset.type;
            return (
              <Chip
                key={preset.id}
                selected={active}
                onClick={() => applyPreset(preset)}
              >
                {presetLabel(preset)}
                {preset.local ? ` · ${t("aiPage.presetLocal")}` : ""}
              </Chip>
            );
          })}
        </div>
        {(() => {
          // Show the "get a key" deep link for the active cloud preset.
          const preset = PROVIDER_PRESETS.find((p) => p.baseUrl === form.baseUrl && p.type === form.type && !p.local && p.apiKeyUrl);
          if (!preset?.apiKeyUrl) return null;
          return (
            <a
              href={preset.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              {t("aiPage.getPresetKey", { name: presetLabel(preset) })}
              <svg className="h-3 w-3" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7m0 0H8m9 0v9" />
              </svg>
            </a>
          );
        })()}
      </div>
    )}
    <FormField label={t("aiPage.nameLabel")} htmlFor={`${prefix}-name`}>
      <Input id={`${prefix}-name`} required value={form.name} onChange={(e) => onChange({ name: e.target.value })} placeholder={t("aiPage.providerNamePlaceholder")} />
    </FormField>
    <FormField label={t("aiPage.typeLabel")} htmlFor={`${prefix}-type`}>
      <select id={`${prefix}-type`} data-input className={CONTROL_CLASS} value={form.type} onChange={(e) => onChange({
        type: e.target.value, baseUrl: COMMON_BASE_URLS[e.target.value] || form.baseUrl, availableModels: "", defaultModel: "",
      })}>
        {Object.entries(PROVIDER_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </FormField>
    <FormField label="API Key" htmlFor={`${prefix}-key`} className="sm:col-span-2">
      <Input id={`${prefix}-key`} type="password" autoComplete="off" required={!editing} value={form.apiKey} onChange={(e) => onChange({ apiKey: e.target.value })} placeholder={editing ? t("aiPage.apiKeyPlaceholder") : "sk-..."} className="font-mono" />
    </FormField>
    <FormField label="Base URL" htmlFor={`${prefix}-base-url`} className="sm:col-span-2">
      <Input id={`${prefix}-base-url`} value={form.baseUrl} onChange={(e) => onChange({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
    </FormField>
    <FormField label={t("aiPage.defaultModelLabel")} htmlFor={`${prefix}-default-model`} className="sm:col-span-2">
      {!editing && models.length > 0 ? <select id={`${prefix}-default-model`} data-input className={CONTROL_CLASS} value={form.defaultModel || models[0]} onChange={(e) => onChange({ defaultModel: e.target.value })}>
        {models.map((model) => <option key={model} value={model}>{model}</option>)}
      </select> : <Input id={`${prefix}-default-model`} value={form.defaultModel} onChange={(e) => onChange({ defaultModel: e.target.value })} />}
    </FormField>
    <CheckboxField label={t("common.setAsDefault")} checked={form.isDefault} onChange={(e) => onChange({ isDefault: e.target.checked })} className="sm:col-span-2" />
  </div>;
}
