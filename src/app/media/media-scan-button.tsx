"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type ScanResult = {
  scanned: number;
  upserted: number;
  removed?: number;
};

export function MediaScanButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isScanning, setIsScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = isScanning || isPending;

  async function handleScan() {
    setIsScanning(true);
    setMessage(null);
    setError(null);
    try {
      const result = await csrfFetch<ScanResult>("/api/media", {
        method: "POST",
      });
      const removedText = result.removed
        ? t("mediaScanButton.removed").replace("{removed}", String(result.removed))
        : "";
      setMessage(
        t("mediaScanButton.summary")
          .replace("{scanned}", String(result.scanned))
          .replace("{upserted}", String(result.upserted))
          .replace("{removedText}", removedText),
      );
      startTransition(() => router.refresh());
    } catch (scanError) {
      setError(
        scanError instanceof Error ? scanError.message : t("mediaScanButton.error"),
      );
    } finally {
      setIsScanning(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={handleScan}
        disabled={disabled}
        className="rounded-xl border border-cyan-400/50 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-cyan-300 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isScanning ? t("mediaScanButton.scanning") : t("mediaScanButton.idle")}
      </button>
      {message && (
        <p
          role="status"
          className="text-sm text-emerald-300"
        >
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
