"use client";

import { useState } from "react";

interface SharePasswordGateProps {
  token: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  /** DIRECTORY shares need archive=1 (or a child path) after password auth. */
  entryType?: string;
}

/**
 * Public share download gate.
 *
 * Password is sent via `X-Share-Password` header (never in the URL) so it does
 * not leak into browser history, server access logs, or Referer headers.
 * Query-string password remains supported server-side for legacy bookmarks.
 */
export function SharePasswordGate({ token, label, placeholder, submitLabel, entryType }: SharePasswordGateProps) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (entryType === "DIRECTORY") params.set("archive", "1");
      const qs = params.toString();
      const url = `/api/share/${encodeURIComponent(token)}${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { "X-Share-Password": pw },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(body.message || body.error || `Download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(cd);
      const fileName = match ? decodeURIComponent(match[1]!.replace(/"/g, "")) : "download";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <label className="block text-xs text-[var(--text-secondary)]" htmlFor="share-access-password">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id="share-access-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={placeholder}
          data-input
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={!pw || busy}
          data-action-button data-variant="primary" className="shrink-0 px-4 py-2 text-sm"
        >
          {submitLabel}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
