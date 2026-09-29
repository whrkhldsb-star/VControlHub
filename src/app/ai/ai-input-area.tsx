"use client";

/**
 * ai-input-area
 *
 * Encapsulates the AI chat composer (file rejection toast, file upload
 * button, hidden file input, message textarea, send/stop buttons). The
 * file attachment state is owned by the parent (`useFileAttachments`
 * hook) and threaded in as a single `fileAttachmentsState` prop so the
 * input area can stay a pure presentational component — the hook
 * reaches into toast notifications and the model-capability context
 * which would otherwise be a cross-cutting refactor.
 *
 * Also owns the "/" slash-command palette: typing "/" as the first
 * character opens a starter list; selecting one inserts its prompt.
 *
 * TR-036 (ai-client.tsx 拆 input area 子组件, 1071 → 987 行)
 */
import { type RefObject, useState } from "react";
import type { ConvItem, ModelCapabilities } from "./ai-types";
import { SLASH_COMMANDS } from "./ai-types";
import type { UseFileAttachmentsReturn } from "./hooks/use-file-attachments";
import { buildAcceptString, formatAllowedTypes } from "./ai-file-helpers";
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";
import { IconButton, Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { isImeComposition } from "@/lib/ui/keyboard";

export interface AiInputAreaProps {
  input: string;
  setInput: (value: string) => void;
  /** External image URL attachments (composer preview); allow send when only URLs are present. */
  imageUrls?: string[];
  streaming: boolean;
  activeConv: ConvItem | undefined;
  currentModelCaps: ModelCapabilities;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  fileAttachmentsState: UseFileAttachmentsReturn;
  handleSend: () => void;
  handleStopGeneration: () => void;
}

export function AiInputArea({
  input,
  setInput,
  imageUrls = [],
  streaming,
  activeConv,
  currentModelCaps,
  textareaRef,
  fileInputRef,
  fileAttachmentsState,
  handleSend,
  handleStopGeneration,
}: AiInputAreaProps) {
  const { t } = useI18n();
  const [slashOpen, setSlashOpen] = useState(false);
  const {
    fileAttachments,
    fileRejectionMsg,
    clearRejection,
    handleFileSelect,
    handlePaste,
  } = fileAttachmentsState;
  const enableVision = activeConv?.enableVision ?? false;
  const allowedTypes = formatAllowedTypes(currentModelCaps, t);

  const slashCommandLabel = (id: string) => {
    const key = `aiPage.slash.${id}`;
    const translated = t(key);
    return translated === key ? id : translated;
  };
  const applySlashCommand = (prompt: string) => {
    setInput(prompt);
    setSlashOpen(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="relative border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] px-4 py-3 backdrop-blur">
      {/* Slash-command palette */}
      {slashOpen && !streaming && (
        <div
          role="listbox"
          aria-label={t("aiPage.slashPaletteLabel")}
          className="absolute bottom-full left-4 z-20 mb-2 w-full max-w-md overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-lg)]"
        >
          {SLASH_COMMANDS.map((command) => (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => applySlashCommand(command.prompt)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              <span className="rounded border border-[var(--accent-border)] bg-[var(--accent-bg)] px-1 py-0.5 font-mono text-[10px] text-[var(--accent)]">
                /{command.id}
              </span>
              <span className="min-w-0 flex-1 truncate">{slashCommandLabel(command.id)}</span>
            </button>
          ))}
        </div>
      )}
      {/* File rejection toast */}
      {fileRejectionMsg && (
        <Notice tone="danger" compact className="mb-2 animate-notice-in">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{fileRejectionMsg}</span>
          <IconButton label={t("aiPage.fileRejectionDismissAria")} onClick={clearRejection} className="ml-auto h-7 w-7 flex-shrink-0">×</IconButton>
        </Notice>
      )}
      <div className="flex gap-2 items-end">
        {/* File upload button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={streaming}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-30"
          aria-label={t("aiPage.uploadFileTitle", { types: allowedTypes })}
          title={t("aiPage.uploadFileTitle", { types: allowedTypes })}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636a9 9 0 11-12.728 0M12 3v12" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={buildAcceptString(currentModelCaps)}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFileSelect(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // "/" alone (or "/" + a partial command id) opens the palette.
            setSlashOpen(e.target.value.startsWith("/"));
          }}
          aria-label={t("aiPage.inputAria")}
          onKeyDown={(e) => {
            if (isImeComposition(e)) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (slashOpen) return; // palette open: Enter closes without sending
              handleSend();
            }
            if (e.key === "Escape" && slashOpen) {
              setSlashOpen(false);
            }
          }}
          onPaste={handlePaste}
          placeholder={
            enableVision
              ? t("aiPage.inputPlaceholderVision", { types: allowedTypes })
              : t("aiPage.inputPlaceholder", { types: allowedTypes })
          }
          rows={1}
          disabled={streaming}
          className={`${UI_INPUT} min-w-0 flex-1 resize-none px-4 py-2.5 placeholder-shown:overflow-hidden placeholder-shown:whitespace-nowrap`}
          style={{ maxHeight: "120px" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 120) + "px";
          }}
        />
        <ActionButton variant="primary"
          onClick={handleSend}
          disabled={streaming || (!input.trim() && fileAttachments.length === 0 && imageUrls.length === 0)} className="flex h-10 w-10 items-center justify-center p-0"
          aria-label={t("aiPage.sendAria")}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </ActionButton>
        {streaming && (
          <ActionButton variant="danger"
            onClick={handleStopGeneration}
            aria-label={t("aiPage.stopGenTitle")}
            title={t("aiPage.stopGenTitle")} className="flex h-10 w-10 items-center justify-center">
            <svg className="w-5 h-5" fill="currentColor" width="24" height="24" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </ActionButton>
        )}
      </div>
    </div>
  );
}
