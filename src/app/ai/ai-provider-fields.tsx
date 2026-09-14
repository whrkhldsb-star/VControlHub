"use client";

import { CheckboxField, CONTROL_CLASS, FormField, Input } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import type { ProviderFormState } from "./ai-provider-panel";
import { COMMON_BASE_URLS, PROVIDER_TYPES } from "./ai-types";

export function AiProviderFields({ form, onChange, editing = false, models = [] }: {
  form: ProviderFormState;
  onChange: (patch: Partial<ProviderFormState>) => void;
  editing?: boolean;
  models?: string[];
}) {
  const { t } = useI18n();
  const prefix = editing ? "ai-provider-edit" : "ai-provider";
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
