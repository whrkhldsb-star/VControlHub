"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";

type ScanResult = {
  scanned: number;
  upserted: number;
  removed?: number;
};

export function MediaScanButton() {
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
        ? `，清理 ${result.removed} 条失效索引`
        : "";
      setMessage(
        `扫描完成：发现 ${result.scanned} 个媒体文件，更新 ${result.upserted} 条索引${removedText}`,
      );
      startTransition(() => router.refresh());
    } catch (scanError) {
      setError(
        scanError instanceof Error ? scanError.message : "扫描媒体索引失败",
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
        className="rounded-xl border border-cyan-400/50 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isScanning ? "正在扫描..." : "扫描媒体索引"}
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
