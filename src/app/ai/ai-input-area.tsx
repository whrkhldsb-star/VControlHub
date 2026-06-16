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

  return (
    <div className="px-4 py-3 border-t border-white/[0.06] bg-slate-950/30">
      {/* File rejection toast */}
      {fileRejectionMsg && (
        <div className="mb-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{fileRejectionMsg}</span>
          <button onClick={clearRejection} className="ml-auto text-red-400/60 hover:text-red-300 flex-shrink-0">×</button>
        </div>
      )}
      <div className="flex gap-2 items-end">
        {/* File upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={streaming}
          className="h-10 w-10 rounded-xl bg-white/[0.04] text-[var(--text-secondary)] flex items-center justify-center hover:bg-white/[0.08] hover:text-slate-200 light:hover:text-slate-800 transition disabled:opacity-30"
          title={t("aiPage.uploadFileTitle").replace("{types}", formatAllowedTypes(currentModelCaps))}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              ? t("aiPage.inputPlaceholderVision").replace("{types}", formatAllowedTypes(currentModelCaps))
              : t("aiPage.inputPlaceholder").replace("{types}", formatAllowedTypes(currentModelCaps))
          }
          rows={1}
          disabled={streaming}
          className="flex-1 bg-black/30 border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-cyan-400/30 transition disabled:opacity-50"
          style={{ maxHeight: "120px" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 120) + "px";
          }}
        />
        <button
          onClick={handleSend}
          disabled={streaming || (!input.trim() && fileAttachments.length === 0)}
          className="h-10 w-10 rounded-xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center hover:bg-cyan-500/30 transition disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label={t("aiPage.sendAria")}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </button>
        {streaming && (
          <button
            onClick={handleStopGeneration}
            className="h-10 w-10 rounded-xl bg-red-500/20 text-red-300 flex items-center justify-center hover:bg-red-500/30 transition"
            title={t("aiPage.stopGenTitle")}
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
