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
import { useCallback, useState } from "react";
import type { FileAttachment, ModelCapabilities } from "../ai-types";
import {
  categorizeFile,
  formatAllowedTypes,
  readFileAsDataURL,
  readFileAsText,
} from "../ai-file-helpers";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_FILE_LENGTH = 100000;
const REJECTION_TIMEOUT_MS = 4000;

export interface UseFileAttachmentsOptions {
  currentModelCaps: ModelCapabilities;
  modelName: string | null | undefined;
  enableVision?: boolean;
  onReject?: (message: string) => void;
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
  onReject,
}: UseFileAttachmentsOptions): UseFileAttachmentsReturn {
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
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
      const fileArr = Array.from(files);
      for (const file of fileArr) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          showRejection(`📄 ${file.name} 超过 20MB 限制`);
          continue;
        }

        const category = categorizeFile(file);

        switch (category) {
          case "image": {
            if (!currentModelCaps.vision && !enableVision) {
              showRejection(
                `🖼 当前模型 ${modelName} 不支持图片输入。请在设置中切换为多模态模型（如 GPT-4o、Claude 3.5 等）`
              );
              continue;
            }
            const dataUrl = await readFileAsDataURL(file);
            const base64Data = dataUrl.split(",")[1];
            setFileAttachments((prev) => [
              ...prev,
              {
                name: file.name,
                content: "",
                type: "image",
                mimeType: file.type || "image/png",
                base64Data,
                preview: dataUrl,
              },
            ]);
            break;
          }
          case "video": {
            if (!currentModelCaps.video) {
              showRejection(
                `🎬 当前模型 ${modelName} 不支持视频输入。支持视频的模型：Gemini 1.5/2、Qwen2-VL、GPT-4o 等`
              );
              continue;
            }
            const dataUrl = await readFileAsDataURL(file);
            const base64Data = dataUrl.split(",")[1];
            setFileAttachments((prev) => [
              ...prev,
              {
                name: file.name,
                content: "",
                type: "image",
                mimeType: file.type || "video/mp4",
                base64Data,
                preview: undefined,
              },
            ]);
            break;
          }
          case "audio": {
            if (!currentModelCaps.audio) {
              showRejection(
                `🎵 当前模型 ${modelName} 不支持音频输入。支持音频的模型：Gemini 2、GPT-4o-audio 等`
              );
              continue;
            }
            const dataUrl = await readFileAsDataURL(file);
            const base64Data = dataUrl.split(",")[1];
            setFileAttachments((prev) => [
              ...prev,
              {
                name: file.name,
                content: "",
                type: "image",
                mimeType: file.type || "audio/mp3",
                base64Data,
                preview: undefined,
              },
            ]);
            break;
          }
          case "document": {
            if (!currentModelCaps.document) {
              if (file.name.toLowerCase().endsWith(".pdf")) {
                showRejection(
                  `📑 当前模型 ${modelName} 不支持 PDF 文件。支持文档的模型：Gemini 1.5/2、Claude 3.5 Sonnet、GPT-4o 等`
                );
                continue;
              }
              showRejection(
                `📑 当前模型 ${modelName} 不支持 Office 文档。支持文档的模型：Gemini 1.5/2、Claude 3.5 Sonnet、GPT-4o 等`
              );
              continue;
            }
            const dataUrl = await readFileAsDataURL(file);
            const base64Data = dataUrl.split(",")[1];
            setFileAttachments((prev) => [
              ...prev,
              {
                name: file.name,
                content: "",
                type: "image",
                mimeType: file.type || "application/pdf",
                base64Data,
                preview: undefined,
              },
            ]);
            break;
          }
          case "text": {
            const text = await readFileAsText(file);
            const truncated =
              text.length > MAX_TEXT_FILE_LENGTH
                ? text.slice(0, MAX_TEXT_FILE_LENGTH) + "\n...(文件过长，已截断)"
                : text;
            setFileAttachments((prev) => [
              ...prev,
              {
                name: file.name,
                content: truncated,
                type: "text",
                mimeType: file.type || "text/plain",
              },
            ]);
            break;
          }
          default: {
            showRejection(
              `❌ 不支持的文件类型: ${file.name}。当前模型可接受：${formatAllowedTypes(currentModelCaps)}`
            );
          }
        }
      }
    },
    [currentModelCaps, enableVision, modelName, showRejection]
  );

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          if (!currentModelCaps.vision && !enableVision) {
            showRejection(`🖼 当前模型不支持图片输入，请在设置中切换为多模态模型`);
            event.preventDefault();
            return;
          }
          event.preventDefault();
          const file = item.getAsFile();
          if (file) await handleFileSelect([file]);
        }
      }
    },
    [currentModelCaps, enableVision, showRejection, handleFileSelect]
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
