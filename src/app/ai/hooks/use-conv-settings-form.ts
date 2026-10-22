"use client";

/**
 * `useConvSettingsForm` — owns the per-conversation tuning panel form
 * (model / system prompt / temperature / maxTokens / topP / penalties /
 * vision toggle / hosting toggle) plus the PATCH that persists those
 * fields.
 *
 * Extracted from ai-client.tsx in R31. The form hydrates from
 * `activeConv` whenever the active conversation changes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { type ConvItem, DEFAULT_SETTINGS_FORM } from "../ai-types";

type ToastFn = (kind: "success" | "error" | "info", message: string) => void;

export function useConvSettingsForm({
  activeConv,
  activeConvId,
  refreshConversations,
  onSaved,
  addToast,
}: {
  activeConv: ConvItem | null;
  activeConvId: string | null;
  refreshConversations: () => Promise<void> | void;
  onSaved: () => void;
  addToast: ToastFn;
}) {
  const { t } = useI18n();
  const [settingsForm, setSettingsForm] = useState(DEFAULT_SETTINGS_FORM);
  const [baseline, setBaseline] = useState(DEFAULT_SETTINGS_FORM);

  // Rehydrate only when the active conversation identity changes — not on every
  // refreshConversations() object replacement (which would clobber dirty edits).
  useEffect(() => {
    if (activeConv && activeConvId) {
      const timer = window.setTimeout(() => {
        const next = {
          model: activeConv.model,
          systemPrompt: activeConv.systemPrompt || "",
          temperature: activeConv.temperature,
          maxTokens: activeConv.maxTokens,
          topP: activeConv.topP,
          frequencyPenalty: activeConv.frequencyPenalty,
          presencePenalty: activeConv.presencePenalty,
          enableVision: activeConv.enableVision,
          hostingEnabled: activeConv.hostingEnabled,
          automationMode: activeConv.automationMode ?? "ASSISTED",
        };
        setSettingsForm(next);
        setBaseline(next);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only activeConvId
  }, [activeConvId]);

  // The model can change outside this form (the header's quick switch).
  // Follow it unless the model field here has its own unsaved edit.
  const serverModel = activeConv?.model;
  useEffect(() => {
    if (!serverModel) return;
    const timer = window.setTimeout(() => {
      setBaseline((previous) => {
        if (previous.model === serverModel) return previous;
        setSettingsForm((form) => (form.model === previous.model ? { ...form, model: serverModel } : form));
        return { ...previous, model: serverModel };
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [serverModel]);

  const dirty = useMemo(
    () => JSON.stringify(settingsForm) !== JSON.stringify(baseline),
    [baseline, settingsForm],
  );

  const handleSaveSettings = useCallback(async () => {
    if (!activeConvId) return;
    // Send what was changed here, not the whole form: the form only loads
    // when the conversation opens, so a model switched since from the header
    // menu went back out as the old one and undid that switch.
    const changes = Object.fromEntries(
      (Object.keys(settingsForm) as Array<keyof typeof settingsForm>)
        .filter((key) => JSON.stringify(settingsForm[key]) !== JSON.stringify(baseline[key]))
        .map((key) => [key, settingsForm[key]]),
    );
    try {
      await csrfFetch(`/api/ai/conversations/${activeConvId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      setBaseline(settingsForm);
      await refreshConversations();
      onSaved();
    } catch {
      // Failed to persist conversation settings — notify the user via toast.
      addToast("error", t("aiPage.saveFailed"));
    }
  }, [
    activeConvId,
    settingsForm,
    baseline,
    refreshConversations,
    onSaved,
    addToast,
    t,
  ]);

  return { settingsForm, setSettingsForm, handleSaveSettings, dirty };
}
