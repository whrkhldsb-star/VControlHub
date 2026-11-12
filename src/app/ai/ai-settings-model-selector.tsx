"use client";

import { useId, useRef, type Dispatch, type SetStateAction } from "react";

import { Eye, Video, Music2, File } from "@/components/icons";
import { IconChevronDown } from "@/components/nav-icons";
import { useDismiss } from "@/components/ui/menu";
import { UI_INPUT } from "@/lib/ui/classes";
import { isImeComposition } from "@/lib/ui/keyboard";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/use-locale";

import type { ModelInfo } from "./ai-types";
import type { SettingsFormState } from "./ai-settings-types";
import { Spinner } from "@/components/ui-primitives";

type Props = {
  settingsForm: SettingsFormState;
  setSettingsForm: Dispatch<SetStateAction<SettingsFormState>>;
  modelList: ModelInfo[];
  modelsLoading: boolean;
  modelDropdownOpen: boolean;
  setModelDropdownOpen: Dispatch<SetStateAction<boolean>>;
  modelSearch: string;
  setModelSearch: Dispatch<SetStateAction<string>>;
  currentModelSupportsVision: boolean;
  onRefreshModels: () => void;
};

/**
 * The conversation's model: the provider's list, narrowed by one field. A provider's list is not always
 * complete (a gateway, a local runtime), so the same field takes an id that is not in it — offered as the
 * last row, and taken on Enter when nothing in the list matches.
 */
export function AiSettingsModelSelector({
  settingsForm,
  setSettingsForm,
  modelList,
  modelsLoading,
  modelDropdownOpen,
  setModelDropdownOpen,
  modelSearch,
  setModelSearch,
  currentModelSupportsVision,
  onRefreshModels,
}: Props) {
  const { t } = useI18n();
  const labelId = useId();
  const valueId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const typed = modelSearch.trim();
  const filteredModels = modelList.filter((m) =>
    m.id.toLowerCase().includes(typed.toLowerCase()),
  );
  const exact = typed ? modelList.find((m) => m.id === typed) : undefined;
  const offerTyped = typed !== "" && !exact;
  const onlyMatch = filteredModels.length === 1 ? filteredModels[0] : undefined;

  const close = () => {
    setModelDropdownOpen(false);
    setModelSearch("");
  };
  const choose = (m: ModelInfo) => {
    setSettingsForm((f) => ({
      ...f,
      model: m.id,
      // Follows the model both ways (A7-06): a non-vision model used to keep images on.
      enableVision: m.vision === undefined ? f.enableVision : m.vision,
    }));
    close();
  };
  const takeTyped = () => {
    setSettingsForm((f) => ({ ...f, model: typed }));
    close();
  };

  useDismiss({
    open: modelDropdownOpen,
    refs: [rootRef],
    onDismiss: (reason) => {
      close();
      if (reason === "escape") triggerRef.current?.focus();
    },
  });

  return (
    <div className="col-span-2 md:col-span-2 relative">
      <span id={labelId} className="ui-label">
        {t("aiPage.model")}
        {modelsLoading && (
          <span className="ml-2 inline-flex items-center gap-2 align-middle text-[var(--text-muted)]">
            <Spinner size="sm" label={t("aiPage.loading")} />
            <span aria-hidden>{t("aiPage.loading")}</span>
          </span>
        )}
      </span>
      <div ref={rootRef} className="relative mt-1">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (modelDropdownOpen ? close() : setModelDropdownOpen(true))}
          aria-expanded={modelDropdownOpen}
          aria-labelledby={`${labelId} ${valueId}`}
          className="ui-control flex items-center justify-between gap-2 text-left text-xs"
        >
          <span className="truncate flex items-center gap-1.5">
            <span id={valueId}>{settingsForm.model}</span>
            {currentModelSupportsVision && (
              <span className="text-xs text-[var(--color-action-text)] bg-[var(--color-action-bg)]/10 px-1 py-0.5 rounded-lg">
                <Eye size={10} aria-hidden="true" />
              </span>
            )}
          </span>
          <IconChevronDown size={14} className={cn("shrink-0 text-[var(--text-muted)] transition-transform", modelDropdownOpen && "rotate-180")} />
        </button>
        {modelDropdownOpen && (
          <div data-popover="" className="absolute left-0 right-0 top-full z-50 mt-1 flex max-h-60 flex-col overflow-hidden">
            <div className="border-b border-[var(--border-subtle)] p-2">
              <input
                value={modelSearch}
                aria-label={t("aiPage.searchModel")}
                onChange={(e) => setModelSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || isImeComposition(e)) return;
                  e.preventDefault();
                  // Enter never picks among several: the id typed in full, the only match, or — with no
                  // match at all — the text as typed.
                  if (exact) choose(exact);
                  else if (onlyMatch) choose(onlyMatch);
                  else if (filteredModels.length === 0 && typed) takeTyped();
                }}
                placeholder={t("aiPage.searchModel")}
                className={cn(UI_INPUT, "px-2 py-1 text-xs")}
                autoFocus
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {modelList.length === 0 && !modelsLoading && (
                <div className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">
                  {t("aiPage.noModels")}{" "}
                  <button
                    type="button"
                    onClick={onRefreshModels}
                    className="ml-2 text-[var(--accent)] hover:text-[var(--accent-hover)]"
                  >
                    {t("aiPage.refresh")}
                  </button>
                </div>
              )}
              {modelList.length > 0 && filteredModels.length === 0 && (
                <div className="px-3 py-3 text-center text-xs text-[var(--text-muted)]">{t("aiPage.noModelMatch")}</div>
              )}
              {filteredModels.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => choose(m)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-[var(--surface-hover)] ${
                    settingsForm.model === m.id
                      ? "bg-[var(--accent-bg)] text-[var(--accent)]"
                      : "text-[var(--text-primary)]"
                  }`}
                >
                  <span className="truncate flex-1">{m.id}</span>
                  <span className="flex items-center gap-0.5 flex-shrink-0">
                    {(m.capabilities?.vision || m.vision) && (
                      <span
                        className="text-xs text-[var(--color-action-text)]/60"
                        title={t("aiPage.visionCap")}
                      >
                        <Eye size={10} aria-hidden="true" />
                      </span>
                    )}
                    {m.capabilities?.video && (
                      <span
                        className="text-xs text-[var(--info)]/60"
                        title={t("aiPage.videoCapSetting")}
                      >
                        <Video size={10} aria-hidden="true" />
                      </span>
                    )}
                    {m.capabilities?.audio && (
                      <span
                        className="text-xs text-[var(--accent)]"
                        title={t("aiPage.audioCapSetting")}
                      >
                        <Music2 size={10} aria-hidden="true" />
                      </span>
                    )}
                    {m.capabilities?.document && (
                      <span
                        className="text-xs text-[var(--success)]/60"
                        title={t("aiPage.documentCapSetting")}
                      >
                        <File size={10} aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  {m.context_length && (
                    <span className="text-xs text-[var(--text-muted)] flex-shrink-0">
                      {(m.context_length / 1000).toFixed(0)}k
                    </span>
                  )}
                  {m.owned_by && (
                    <span className="text-xs text-[var(--text-muted)] flex-shrink-0 truncate max-w-[60px]">
                      {m.owned_by}
                    </span>
                  )}
                </button>
              ))}
              {offerTyped && (
                <button
                  type="button"
                  onClick={takeTyped}
                  className="flex w-full items-center border-t border-[var(--border-subtle)] px-3 py-2 text-left text-xs text-[var(--accent)] transition hover:bg-[var(--surface-hover)]"
                >
                  <span className="truncate">{t("aiPage.useModelId", { id: typed })}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
