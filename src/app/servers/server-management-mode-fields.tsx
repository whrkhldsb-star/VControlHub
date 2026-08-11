"use client";

import { useState } from "react";
import { Radio, Server } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";

export function ServerManagementModeFields({
  defaultValue = "DIRECT",
  onChange,
}: {
  defaultValue?: "DIRECT" | "AGENT";
  onChange?: (value: "DIRECT" | "AGENT") => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState<"DIRECT" | "AGENT">(defaultValue);
  const options = [
    { value: "DIRECT" as const, Icon: Server, title: t("serversPage.management.direct"), detail: t("serversPage.management.directHint") },
    { value: "AGENT" as const, Icon: Radio, title: t("serversPage.management.agent"), detail: t("serversPage.management.agentHint") },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-[var(--text-primary)]/70">{t("serversPage.management.title")}</legend>
      <input type="hidden" name="managementMode" value={value} />
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setValue(option.value);
                onChange?.(option.value);
              }}
              className={`min-h-[76px] rounded-lg border p-3 text-left transition ${selected ? "border-[var(--color-action-border)] bg-[var(--color-action-bg)]/10" : "border-[var(--border)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-hover)]"}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]"><option.Icon size={16} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />{option.title}</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{option.detail}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
