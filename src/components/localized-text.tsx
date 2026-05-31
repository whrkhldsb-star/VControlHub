"use client";

import { useI18n } from "@/lib/i18n/use-locale";

export function LocalizedText({ textKey, fallback }: { textKey: string; fallback: string }) {
  const { t } = useI18n();
  const translated = t(textKey);
  return <>{translated === textKey ? fallback : translated}</>;
}

export function useLocalizedText(textKey: string, fallback: string) {
  const { t } = useI18n();
  const translated = t(textKey);
  return translated === textKey ? fallback : translated;
}
