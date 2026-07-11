"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { LinkIcon } from "@/components/icons";
import type { StorageEntry } from "./file-entry-utils";

type ShareFileButtonProps = {
  entry: StorageEntry;
  compact?: boolean;
  variant?: "button" | "menu";
  onNotify?: (type: "success" | "error" | "info", message: string) => void;
};

export function ShareFileButton({
  entry,
  compact = false,
  variant = "button",
  onNotify,
}: ShareFileButtonProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const canShare = entry.entryType === "FILE";
  const label = useMemo(
    () => (compact ? t("sharesPage.button.compact") : `${t("sharesPage.button.compact")} ${entry.name}`),
    [compact, entry.name, t],
  );

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function handleShare() {
    if (!canShare || saving) return;
    setSaving(true);
    setError("");
    try {
      const data = await csrfFetch<{ token: string }>("/api/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileEntryId: entry.id }),
      });
      const url = `${window.location.origin}/share/${data.token}`;
      setShareUrl(url);
      await copy(url);
      onNotify?.("success", t("sharesPage.button.copiedNotify"));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("sharesPage.button.errorFallback");
      setError(message);
      onNotify?.("error", message);
    } finally {
      setSaving(false);
    }
  }

  if (!canShare) return null;

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={handleShare}
        disabled={saving}
        title={shareUrl ? t("sharesPage.button.regenerate") : t("sharesPage.button.title")}
        aria-label={label}
        className={
          variant === "menu"
            ? "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--success)] transition hover:bg-[var(--success-bg)] disabled:opacity-50"
            : compact
            ? "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)] transition hover:bg-[var(--success-bg)] disabled:opacity-50"
            : "inline-flex items-center gap-1.5 rounded-lg border border-[var(--success-border)] bg-[var(--success-bg)] px-2.5 py-1.5 text-xs text-[var(--success)] transition hover:bg-[var(--success-bg)] disabled:opacity-50"
        }
      >
        <LinkIcon size={14} aria-hidden="true" />
        {variant === "menu" || !compact ? (
          <span>{saving ? t("sharesPage.button.submitting") : copied ? t("sharesPage.button.copied") : t("sharesPage.button.compact")}</span>
        ) : null}
      </button>
      {shareUrl || error ? (
        <div className="absolute right-0 top-10 z-30 w-72 rounded-xl border border-[var(--border)] bg-[var(--modal-bg)] p-3 text-left text-xs shadow-xl">
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => {
              setShareUrl("");
              setError("");
              setCopied(false);
            }}
            className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            ×
          </button>
          {error ? (
            <p className="pr-8 text-[var(--danger)]">{error}</p>
          ) : null}
          {shareUrl ? (
            <div className="space-y-2">
              <p className="pr-8 font-medium text-[var(--success)]">
                {copied ? t("sharesPage.button.generatedAndCopied") : t("sharesPage.button.generated")}
              </p>
              <code className="block break-all rounded-lg bg-[var(--surface)]/[0.04] p-2 text-[var(--text-secondary)]">
                {shareUrl}
              </code>
              <button
                type="button"
                onClick={() => copy(shareUrl)}
                className="rounded-lg border border-[var(--success-border)] px-2 py-1 text-[var(--success)]"
              >
                {copied ? t("sharesPage.button.copied") : t("sharesPage.button.copy")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
