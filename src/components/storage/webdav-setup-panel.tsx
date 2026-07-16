"use client";

import { useMemo, useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

type NodeOption = { id: string; name: string; driver: string };

export function WebDavSetupPanel({ nodes }: { nodes: NodeOption[] }) {
  const { t } = useI18n();
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "");
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://<host>";

  const url = useMemo(() => {
    if (!nodeId) return "";
    return `${origin}/api/webdav/${encodeURIComponent(nodeId)}/`;
  }, [nodeId, origin]);

  if (nodes.length === 0) {
    return <p className="text-xs text-[var(--text-muted)]">{t("filesPage.webdav.noNodes")}</p>;
  }

  return (
    <div className="space-y-3 text-xs text-[var(--text-secondary)]">
      <p className="leading-relaxed">{t("filesPage.webdav.help")}</p>
      <label className="block">
        <span className="text-[11px] text-[var(--text-muted)]">{t("filesPage.webdav.selectNode")}</span>
        <select
          className={`${UI_INPUT} mt-1`}
          value={nodeId}
          onChange={(e) => setNodeId(e.target.value)}
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} ({n.driver})
            </option>
          ))}
        </select>
      </label>
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3 font-mono text-[11px] break-all">
        {url || t("filesPage.webdav.pickNode")}
      </div>
      <ul className="list-disc space-y-1 pl-4 text-[11px] text-[var(--text-muted)]">
        <li>{t("filesPage.webdav.authBearer")}</li>
        <li>{t("filesPage.webdav.authBasic")}</li>
        <li>{t("filesPage.webdav.scopes")}</li>
        <li>{t("filesPage.webdav.methods")}</li>
      </ul>
      <a
        href="/api-tokens"
        className="inline-flex min-h-11 items-center text-[var(--accent)] underline-offset-2 hover:underline"
      >
        {t("filesPage.webdav.manageTokens")}
      </a>
    </div>
  );
}
