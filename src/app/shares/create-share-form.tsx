"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

interface StorageNode {
  id: string;
  name: string;
}

export function CreateShareForm({ nodes }: { nodes: StorageNode[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "");
  const [path, setPath] = useState("");
  const [entryType, setEntryType] = useState<"FILE" | "DIRECTORY">("DIRECTORY");
  const [permissionLevel, setPermissionLevel] = useState<"preview" | "download">("download");
  const [name, setName] = useState("");
  const [expiresIn, setExpiresIn] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const shareUrl = result
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${result.token}`
    : "";

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard may be unavailable; the URL remains visible for manual copy. */
    }
  };

  const handleCreate = async () => {
    setSaving(true);
    setError("");
    setResult(null);
    try {
      const body: Record<string, unknown> = { storageNodeId: nodeId, path, entryType, permissionLevel };
      if (name.trim()) body.name = name.trim();
      if (expiresIn) body.expiresInHours = Number(expiresIn);
      if (password.trim()) body.password = password.trim();
      const data = await csrfFetch<{ token: string }>("/api/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setResult({ token: data.token });
      setPath("");
      setName("");
      setExpiresIn("");
      setPassword("");
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("sharesPage.create.errorFallback"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          data-action-button data-variant="primary" className="px-4 py-2.5 text-sm"
        >
          {t("sharesPage.create.title")}
        </button>
      ) : (
 <div data-card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("sharesPage.create.advancedTitle")}</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("sharesPage.create.desc")}</p>
            </div>
            <button onClick={() => { setOpen(false); setResult(null); setError(""); }} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">{t("common.collapse")}</button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1" htmlFor="createShareNode">{t("sharesPage.create.node")}</label>
              <select id="createShareNode" value={nodeId} onChange={(e) => setNodeId(e.target.value)} data-input className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm outline-none">
                {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1" htmlFor="createSharePath">{t("sharesPage.create.path")}</label>
              <input id="createSharePath" value={path} onChange={(e) => setPath(e.target.value)} placeholder={entryType === "DIRECTORY" ? t("sharesPage.create.pathPlaceholderDirectory") : t("sharesPage.create.pathPlaceholderFile")} data-input className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1" htmlFor="createShareEntryType">{t("sharesPage.create.entryType")}</label>
              <select id="createShareEntryType" value={entryType} onChange={(e) => setEntryType(e.target.value as "FILE" | "DIRECTORY")} data-input className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm outline-none">
                <option value="DIRECTORY">{t("sharesPage.create.entryType.DIRECTORY")}</option>
                <option value="FILE">{t("sharesPage.create.entryType.FILE")}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1" htmlFor="createSharePermissionLevel">{t("sharesPage.create.permissionLevel")}</label>
              <select id="createSharePermissionLevel" value={permissionLevel} onChange={(e) => setPermissionLevel(e.target.value as "preview" | "download")} data-input className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm outline-none">
                <option value="download">{t("sharesPage.create.permissionLevel.download")}</option>
                <option value="preview">{t("sharesPage.create.permissionLevel.preview")}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1" htmlFor="createShareName">{t("sharesPage.create.name")}</label>
              <input id="createShareName" value={name} onChange={(e) => setName(e.target.value)} data-input className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label htmlFor="share-expires-in" className="block text-xs text-[var(--text-secondary)] mb-1">{t("sharesPage.create.expires")}</label>
              <input id="share-expires-in" type="number" value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)} placeholder="72" data-input className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label htmlFor="share-password" className="block text-xs text-[var(--text-secondary)] mb-1">{t("sharesPage.create.password")}</label>
              <input id="share-password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("sharesPage.create.passwordPlaceholder")} data-input className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm outline-none" />
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}

          {result && (
            <div data-tone="emerald" className="mt-3 rounded-lg border border-[var(--success-border)] p-3">
              <p className="text-xs text-[var(--success)] font-medium">{t("sharesPage.create.success")}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="block flex-1 break-all text-xs text-[var(--success)]">{shareUrl || `/share/${result.token}`}</code>
                <button
                  type="button"
                  onClick={handleCopy}
                  data-tone="emerald" data-action-button data-variant="success" className="shrink-0 !px-3 !py-1.5 !text-xs"
                >
                  {copied ? t("sharesPage.create.copied") : t("sharesPage.create.copy")}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">{t("sharesPage.create.tokenWarning")}</p>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={saving || !nodeId || !path.trim()}
            data-action-button data-variant="primary" className="mt-4 px-4 py-2.5 text-sm"
          >
            {saving ? t("sharesPage.create.submitting") : t("sharesPage.create.submit")}
          </button>
        </div>
      )}
    </div>
  );
}
