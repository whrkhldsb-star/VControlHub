"use client";

import { useState } from "react";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";

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
 * Password is posted in a same-origin JSON request and exchanged for a short-
 * lived HttpOnly cookie. The actual download then uses a normal browser GET,
 * preserving streaming and the native download manager for large files.
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
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(body.message || body.error || `Download failed (${res.status})`);
        return;
      }
      window.location.assign(url);
    } catch (err) {
      setError(getErrorMessage(err, "Download failed"));
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
        <ActionButton variant="primary"
          type="submit"
          disabled={!pw || busy} className="shrink-0 px-4 py-2 text-sm"
        >
          {submitLabel}
        </ActionButton>
      </div>
      {error ? (
        <p className="text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
