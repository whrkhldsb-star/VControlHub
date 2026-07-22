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
 * TR-036 (ai-client.tsx 拆 input area 子组件, 1071 → 987 行)
 */
import type { RefObject } from "react";
import type { ConvItem, ModelCapabilities } from "./ai-types";
import type { UseFileAttachmentsReturn } from "./hooks/use-file-attachments";
import { buildAcceptString, formatAllowedTypes } from "./ai-file-helpers";
import { useI18n } from "@/lib/i18n/use-locale";

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
  const {
    fileAttachments,
    fileRejectionMsg,
    clearRejection,
    handleFileSelect,
    handlePaste,
  } = fileAttachmentsState;
  const enableVision = activeConv?.enableVision ?? false;
  const allowedTypes = formatAllowedTypes(currentModelCaps, t);

  return (
    <div className="border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] px-4 py-3 backdrop-blur">
      {/* File rejection toast */}
      {fileRejectionMsg && (
        <div className="mb-2 px-3 py-2 rounded-lg bg-[var(--danger-bg)] border border-[var(--danger-border)] text-xs text-[var(--danger)] flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{fileRejectionMsg}</span>
          <button type="button" onClick={clearRejection} aria-label={t("aiPage.fileRejectionDismissAria")} className="ml-auto text-[var(--danger)]/60 hover:text-[var(--danger)] flex-shrink-0">×</button>
        </div>
      )}
      <div className="flex gap-2 items-end">
        {/* File upload button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={streaming}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-30"
          aria-label={t("aiPage.uploadFileTitle").replace("{types}", allowedTypes)}
          title={t("aiPage.uploadFileTitle").replace("{types}", allowedTypes)}
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
          onChange={(e) => setInput(e.target.value)}
          aria-label={t("aiPage.inputAria")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          onPaste={handlePaste}
          placeholder={
            enableVision
              ? t("aiPage.inputPlaceholderVision").replace("{types}", allowedTypes)
              : t("aiPage.inputPlaceholder").replace("{types}", allowedTypes)
          }
          rows={1}
          disabled={streaming}
          data-input
          className="flex-1 resize-none rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition focus:border-[var(--input-border-focus)] focus:shadow-[0_0_0_3px_var(--input-ring)] focus:outline-none disabled:opacity-50"
          style={{ maxHeight: "120px" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 120) + "px";
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={streaming || (!input.trim() && fileAttachments.length === 0 && imageUrls.length === 0)}
          data-action-button data-variant="primary" className="flex h-10 w-10 items-center justify-center p-0"
          aria-label={t("aiPage.sendAria")}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </button>
        {streaming && (
          <button
            type="button"
            onClick={handleStopGeneration}
            aria-label={t("aiPage.stopGenTitle")}
            title={t("aiPage.stopGenTitle")}
           data-action-button data-variant="danger" className="flex h-10 w-10 items-center justify-center">
            <svg className="w-5 h-5" fill="currentColor" width="24" height="24" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
