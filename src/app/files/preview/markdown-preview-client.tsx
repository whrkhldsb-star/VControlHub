"use client";

import { useState, useEffect, useMemo } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { useAbortableTextResource } from "@/lib/http/use-abortable-text-resource";
import { AlertTriangle } from "@/components/icons";
import { Badge, InlineLoading, Notice } from "@/components/ui-primitives";
import { getErrorMessage } from "@/lib/http/error-message";
import { MARKDOWN_PROSE_CLASS, renderMarkdown } from "@/lib/markdown/render-markdown";
import { TEXT_PREVIEW_MAX_BYTES } from "@/lib/http/read-text-prefix";



export function MarkdownPreviewClient({ href }: { href: string }) {
  const { t } = useI18n();
  const state = useAbortableTextResource({
    href,
    maxBytes: TEXT_PREVIEW_MAX_BYTES,
    errorMessage: (status) => t("markdownPreview.loadFailedWithStatus", { status }),
    getErrorMessage: (error) => getErrorMessage(error, t("markdownPreview.loadFailed")),
  });
  const [sanitizeFn, setSanitizeFn] = useState<
    ((html: string) => string) | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    import("@/lib/sanitize/html-sanitizer").then((m) => {
      if (!cancelled) setSanitizeFn(() => m.sanitizeHtml);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const html = useMemo(
    () =>
      sanitizeFn
        ? sanitizeFn(
            renderMarkdown(state.content ?? ""),
          )
        : "",
    [state, sanitizeFn],
  );

  if (state.loading) {
    return <InlineLoading label={t("markdownPreview.loading")} className="py-16" />;
  }

  if (state.error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-[var(--danger)]">
        <AlertTriangle size={32} aria-hidden="true" />
        <p className="text-sm">{state.error}</p>
      </div>
    );
  }

  if (!sanitizeFn) {
    return <InlineLoading label={t("markdownPreview.loading")} className="py-16" />;
  }

  return (
    <div className="overflow-auto rounded-2xl bg-[var(--surface)] p-4">
      {/* Label */}
      <div className="mb-3 flex items-center gap-2">
        <Badge tone="accent">
          {t("markdownPreview.title")}
        </Badge>
      </div>

      {state.truncated ? (
        <Notice tone="warning" className="mb-3">
          {t("markdownPreview.prefixOnly", { size: TEXT_PREVIEW_MAX_BYTES / 1024 / 1024 })}
        </Notice>
      ) : null}

      {/* Rendered markdown */}
      <div
        className={MARKDOWN_PROSE_CLASS}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
