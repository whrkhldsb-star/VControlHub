"use client";

import { useState } from "react";

interface SharePasswordGateProps {
  token: string;
  label: string;
  placeholder: string;
  submitLabel: string;
}

export function SharePasswordGate({ token, label, placeholder, submitLabel }: SharePasswordGateProps) {
  const [pw, setPw] = useState("");
  const url = `/api/share/${encodeURIComponent(token)}?password=${encodeURIComponent(pw)}`;

  return (
    <div className="space-y-3">
      <label className="block text-xs text-[var(--text-secondary)]" htmlFor="share-access-password">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id="share-access-password"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={placeholder}
          data-input
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
        />
        <a
          href={url}
          className="shrink-0 rounded-lg bg-cyan-600 px-4 py-2 text-center text-sm font-medium text-[var(--text-primary)] transition hover:bg-cyan-500 disabled:opacity-40"
          aria-disabled={!pw}
          onClick={(e) => { if (!pw) e.preventDefault(); }}
        >
          {submitLabel}
        </a>
      </div>
    </div>
  );
}
