"use client";

import { ActionButton, ButtonLink } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { copyText } from "@/lib/ui/clipboard";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";

type NodeOption = { id: string; name: string; driver: string };

export function WebDavSetupPanel({ nodes, origin }: { nodes: NodeOption[]; origin: string }) {
  const { t } = useI18n();
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "");

  const [feedback, setFeedback] = useState("");
  const url = useMemo(() => {
    if (!nodeId) return "";
    return `${origin}/api/webdav/${encodeURIComponent(nodeId)}/`;
  }, [nodeId, origin]);

  if (nodes.length === 0) {
    return <Notice tone="info">{t("filesPage.webdav.noNodes")} <ButtonLink href="/files" size="sm">{t("filesPage.subNav.browser")}</ButtonLink></Notice>;
  }

  return (
    <div className="space-y-3 text-xs text-[var(--text-secondary)]">
      <p className="leading-relaxed">{t("filesPage.webdav.help")}</p>
      <label className="block">
        <span className="text-xs text-[var(--text-muted)]">{t("filesPage.webdav.selectNode")}</span>
        <select
          className={`${UI_INPUT} mt-1`}
          value={nodeId}
          onChange={(e) => { setNodeId(e.target.value); setFeedback(""); }}
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} ({getStorageDriverLabel(t, n.driver)})
            </option>
          ))}
        </select>
      </label>
      <p>{t("filesPage.webdav.stepCopy")}</p>
      <div data-inset className="p-3 font-mono text-xs break-all">
        {url || t("filesPage.webdav.pickNode")}
      </div>
      <ActionButton size="sm" onClick={async () => setFeedback(await copyText(url) ? "filesPage.webdav.copied" : "filesPage.webdav.copyFailed")}>{t("filesPage.webdav.copy")}</ActionButton>
      <span role="status">{feedback && t(feedback)}</span>
      <p>{t("filesPage.webdav.stepConnect")}</p>
      <ul className="list-disc space-y-1 pl-4 text-xs text-[var(--text-muted)]">
        <li>{t("filesPage.webdav.authBearer")}</li>
        <li>{t("filesPage.webdav.authBasic")}</li>
        <li>{t("filesPage.webdav.scopes")}</li>
        <li>{t("filesPage.webdav.methods")}</li>
      </ul>
      <Link
        href="/api-tokens"
        className="inline-flex min-h-11 items-center text-[var(--accent)] underline-offset-2 hover:underline"
      >
        {t("filesPage.webdav.manageTokens")}
      </Link>
    </div>
  );
}
