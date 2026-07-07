"use client";

/**
 * `useProviderForm` — owns the create-provider form state plus the
 * `handleCreateProvider` mutation that POSTs to /api/ai/providers and
 * refreshes the parent's provider list on success.
 *
 * Extracted from ai-client.tsx in R31.
 */
import { useCallback, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { DEFAULT_PROV_FORM } from "../ai-types";

type ToastFn = (kind: "success" | "error" | "info", message: string) => void;

export function useProviderForm({
  refreshProviders,
  addToast,
}: {
  refreshProviders: () => Promise<void> | void;
  addToast: ToastFn;
}) {
  const { t } = useI18n();
  const [provForm, setProvForm] = useState(DEFAULT_PROV_FORM);

  const handleCreateProvider = useCallback(async () => {
    if (!provForm.name.trim() || !provForm.apiKey.trim()) {
      addToast("error", t("aiPage.nameAndKeyRequired"));
      return;
    }
    const baseUrl = provForm.baseUrl.trim();
    const models = provForm.availableModels
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    try {
      await csrfFetch("/api/ai/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...provForm,
          ...(baseUrl ? { baseUrl } : {}),
          models: models.join(","),
          availableModels: models,
        }),
      });
      await refreshProviders();
      setProvForm({ ...DEFAULT_PROV_FORM });
    } catch {
      // Provider creation failed — notify the user via toast.
      addToast("error", t("aiPage.addProviderFailed"));
    }
  }, [provForm, refreshProviders, addToast, t]);

  return { provForm, setProvForm, handleCreateProvider };
}
