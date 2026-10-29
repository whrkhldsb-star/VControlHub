"use client";

/**
 * useFileAttachments
 *
 * Encapsulates the file selection / paste / drag-and-drop pipeline used by
 * the AI chat composer. Decides which attachments are accepted based on the
 * active model's capabilities, normalises them into `FileAttachment[]`, and
 * surfaces capability / size rejections via an optional callback.
 *
 * TR-017 (ai-client 拆分)
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { FileAttachment, ModelCapabilities } from "../ai-types";
import {
  categorizeFile,
  formatAllowedTypes,
  readFileAsDataURL,
  readFileAsText,
} from "../ai-file-helpers";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
/**
 * An image or PDF travels inside the chat request as base64 (4/3 of its size); the request schema takes 8,000,000
 * characters of it per attachment and the route 32 MiB in all. The 20 MB the page offered never got through.
 */
const MAX_BINARY_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_FILE_LENGTH = 100000;
const REJECTION_TIMEOUT_MS = 4000;

export interface UseFileAttachmentsOptions {
  currentModelCaps: ModelCapabilities;
  modelName: string | null | undefined;
  enableVision?: boolean;
  /**
   * The conversation's provider type. Only images go to every provider; PDFs
   * only to Anthropic (sent as document blocks). Audio and video have no
   * adapted request format yet: they were sent as images and misread.
   */
  providerType?: string | null;
  onReject?: (message: string) => void;
  t?: (key: string, vars?: Record<string, string | number>) => string;
}

export interface UseFileAttachmentsReturn {
  fileAttachments: FileAttachment[];
  fileRejectionMsg: string | null;
  clearRejection: () => void;
  handleFileSelect: (files: FileList | File[]) => Promise<void>;
  handlePaste: (event: React.ClipboardEvent) => Promise<void>;
  handleDrop: (event: React.DragEvent) => Promise<void>;
  handleDragOver: (event: React.DragEvent) => void;
  clearAttachments: () => void;
  setFileAttachments: React.Dispatch<React.SetStateAction<FileAttachment[]>>;
}

export function useFileAttachments({
  currentModelCaps,
  modelName,
  enableVision,
  providerType,
  onReject,
  t,
}: UseFileAttachmentsOptions): UseFileAttachmentsReturn {
  const tr = useMemo(
    () =>
      t ??
      ((key: string, vars?: Record<string, string | number>) =>
        vars ? Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), key) : key),
    [t],
  );
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
  // Bumped when the attachments are cleared for another conversation. A file
  // still being read for the previous one must not land in this one (it was
  // sent with the next conversation's message).
  const generation = useRef(0);
  const [fileRejectionMsg, setFileRejectionMsg] = useState<string | null>(null);

  const showRejection = useCallback(
    (message: string) => {
      setFileRejectionMsg(message);
      onReject?.(message);
      setTimeout(() => setFileRejectionMsg(null), REJECTION_TIMEOUT_MS);
    },
    [onReject]
  );

  const handleFileSelect = useCallback(
    async (files: FileList | File[]) => {
      const startedIn = generation.current;
      const attach = (attachment: FileAttachment) => {
        if (generation.current !== startedIn) return;
        setFileAttachments((prev) => [...prev, attachment]);
      };
      const fileArr = Array.from(files);
      for (const file of fileArr) {
        try {
          if (file.size > MAX_FILE_SIZE_BYTES) {
            showRejection(tr("aiPage.fileTooLarge", { name: file.name }));
            continue;
          }

          const category = categorizeFile(file);
          if ((category === "image" || category === "document") && file.size > MAX_BINARY_ATTACHMENT_BYTES) {
            showRejection(tr("aiPage.attachmentTooLarge", { name: file.name, limit: 5 }));
            continue;
          }

          switch (category) {
            case "image": {
              if (!currentModelCaps.vision && !enableVision) {
                showRejection(
                  tr("aiPage.unsupportedImageModel", { model: modelName ?? "-" })
                );
                continue;
              }
              const dataUrl = await readFileAsDataURL(file);
              const base64Data = dataUrl.split(",")[1];
              attach({
                name: file.name,
                content: "",
                type: "image",
                mimeType: file.type || "image/png",
                base64Data,
                preview: dataUrl,
              });
              break;
            }
            case "video":
            case "audio": {
              if (!currentModelCaps[category]) {
                showRejection(
                  tr(category === "video" ? "aiPage.unsupportedVideoModel" : "aiPage.unsupportedAudioModel", { model: modelName ?? "-" })
                );
                continue;
              }
              // No provider request format for these yet: they used to go out
              // as images, which no provider reads as audio or video.
              showRejection(tr("aiPage.unsupportedMediaAttachment", { name: file.name }));
              continue;
            }
            case "document": {
              if (!currentModelCaps.document) {
                if (file.name.toLowerCase().endsWith(".pdf")) {
                  showRejection(
                    tr("aiPage.unsupportedPdfModel", { model: modelName ?? "-" })
                  );
                  continue;
                }
                showRejection(
                  tr("aiPage.unsupportedOfficeModel", { model: modelName ?? "-" })
                );
                continue;
              }
              // PDFs reach the model only through Anthropic's document blocks.
              if (providerType !== "ANTHROPIC" || !file.name.toLowerCase().endsWith(".pdf")) {
                showRejection(tr("aiPage.unsupportedDocumentProvider", { name: file.name }));
                continue;
              }
              const dataUrl = await readFileAsDataURL(file);
              const base64Data = dataUrl.split(",")[1];
              attach({
                name: file.name,
                content: "",
                type: "document",
                mimeType: file.type || "application/pdf",
                base64Data,
                preview: undefined,
              });
              break;
            }
            case "text": {
              const text = await readFileAsText(file);
              const truncated =
                text.length > MAX_TEXT_FILE_LENGTH
                  ? text.slice(0, MAX_TEXT_FILE_LENGTH) + tr("aiPage.fileTruncatedSuffix")
                  : text;
              attach({
                name: file.name,
                content: truncated,
                type: "text",
                mimeType: file.type || "text/plain",
              });
              break;
            }
            default: {
              showRejection(
                tr("aiPage.unsupportedFileType", { name: file.name, types: formatAllowedTypes(currentModelCaps, tr) })
              );
            }
          }
        } catch {
          showRejection(tr("aiPage.fileReadFailed", { name: file.name }));
        }
      }
    },
    [currentModelCaps, enableVision, modelName, providerType, showRejection, tr]
  );

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          if (!currentModelCaps.vision && !enableVision) {
            showRejection(tr("aiPage.unsupportedPasteImage"));
            event.preventDefault();
            return;
          }
          event.preventDefault();
          const file = item.getAsFile();
          if (file) await handleFileSelect([file]);
        }
      }
    },
    [currentModelCaps, enableVision, showRejection, handleFileSelect, tr]
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer.files.length > 0) {
        await handleFileSelect(event.dataTransfer.files);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const clearAttachments = useCallback(() => {
    generation.current += 1;
    setFileAttachments([]);
  }, []);

  const clearRejection = useCallback(() => {
    setFileRejectionMsg(null);
  }, []);

  return {
    fileAttachments,
    fileRejectionMsg,
    clearRejection,
    handleFileSelect,
    handlePaste,
    handleDrop,
    handleDragOver,
    clearAttachments,
    setFileAttachments,
  };
}
