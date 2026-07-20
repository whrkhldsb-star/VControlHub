"use client";

/**
 * Image-URL list + file attachment thumbnails shown above the input
 * area, plus the optional "paste an image URL" input that's only
 * rendered when the active conversation has vision enabled.
 *
 * Extracted from ai-client.tsx in R31.
 */
import Image from "next/image";
import type { Dispatch, SetStateAction } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { Video, Music2, File } from "@/components/icons";
import type { FileAttachment } from "./ai-types";

type Props = {
  enableVision: boolean;
  imageUrls: string[];
  setImageUrls: Dispatch<SetStateAction<string[]>>;
  imageUrlInput: string;
  setImageUrlInput: Dispatch<SetStateAction<string>>;
  fileAttachments: FileAttachment[];
  setFileAttachments: Dispatch<SetStateAction<FileAttachment[]>>;
};

export function AiAttachmentsPreview({
  enableVision,
  imageUrls,
  setImageUrls,
  imageUrlInput,
  setImageUrlInput,
  fileAttachments,
  setFileAttachments,
}: Props) {
  const { t } = useI18n();
  const hasAnyPreview =
    fileAttachments.length > 0 || (enableVision && imageUrls.length > 0);
  return (
    <>
      {hasAnyPreview && (
        <div className="px-4 pb-1.5 border-t border-[var(--border)] bg-[var(--surface-subtle)]">
          <div className="flex flex-wrap gap-2 py-2">
            {imageUrls.map((url, i) => (
              <div key={`url-${i}`} className="relative group">
                <Image
                  src={url}
                  alt=""
                  width={48}
                  height={48}
                  loading="lazy"
                  unoptimized
                  className="w-12 h-12 rounded object-cover border border-[var(--border)]"
                />
                <button
                  onClick={() =>
                    setImageUrls((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--danger)] text-[var(--text-primary)] text-[8px] flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition"
                >
                  ×
                </button>
              </div>
            ))}
            {fileAttachments.map((file, i) => (
              <div key={`file-${i}`} className="relative group">
                {file.type === "image" && file.preview ? (
                  <Image
                    src={file.preview}
                    alt={file.name}
                    width={48}
                    height={48}
                    loading="lazy"
                    unoptimized
                    className="w-12 h-12 rounded object-cover border border-[var(--border)]"
                  />
                ) : (
                  <div className="w-12 h-12 rounded border border-[var(--input-border)] bg-[var(--input-bg)] flex flex-col items-center justify-center">
                    {file.mimeType.startsWith("video/") ? (
                      <span className="text-base" title={t("aiPage.videoFileTitle")}>
                        <Video size={16} aria-hidden="true" />
                      </span>
                    ) : file.mimeType.startsWith("audio/") ? (
                      <span className="text-base" title={t("aiPage.audioFileTitle")}>
                        <Music2 size={16} aria-hidden="true" />
                      </span>
                    ) : file.mimeType === "application/pdf" ||
                      file.mimeType.includes("officedocument") ? (
                      <span
                        className="text-base"
                        title={t("aiPage.documentFileTitle")}
                      >
                        <File size={16} aria-hidden="true" />
                      </span>
                    ) : (
                      <svg
                        className="w-4 h-4 text-[var(--text-muted)]"
                        fill="none"
                        stroke="currentColor"
                        width="24" height="24" viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    )}
                    <span className="text-[7px] text-[var(--text-muted)] truncate max-w-[44px] mt-0.5">
                      {file.name}
                    </span>
                  </div>
                )}
                <button
                  onClick={() =>
                    setFileAttachments((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--danger)] text-[var(--text-primary)] text-[8px] flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {enableVision && (
        <div className="px-4 pb-1">
          <div className="flex gap-2">
            <input
              value={imageUrlInput}
              aria-label={t("aiPage.imageUrlAria")}
              onChange={(e) => setImageUrlInput(e.target.value)}
              placeholder={t("aiPage.imageUrlPlaceholder")}
              className="flex-1 bg-[var(--input-bg)] border border-[var(--border)]/10 rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && imageUrlInput.trim()) {
                  setImageUrls((prev) => [...prev, imageUrlInput.trim()]);
                  setImageUrlInput("");
                }
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
