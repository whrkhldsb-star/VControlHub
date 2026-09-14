"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { ClipboardList, Plus, Server } from "@/components/icons";
import { IconCode, IconKey } from "@/components/nav-items";
import { SegmentedTabs } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";

type PanelKey = "nodes" | "command" | "create" | "sshkeys" | "batch";

const actions = [
  { key: "nodes", labelKey: "serversPage.tabs.overview", icon: <Server size={18} /> },
  { key: "command", labelKey: "serversPage.tabs.command", icon: <IconCode /> },
  { key: "create", labelKey: "serversPage.tabs.addVps", icon: <Plus size={18} /> },
  { key: "sshkeys", labelKey: "serversPage.tabs.addKey", icon: <IconKey /> },
  { key: "batch", labelKey: "serversPage.tabs.batch", icon: <ClipboardList size={18} /> },
] satisfies { key: PanelKey; labelKey: string; icon: ReactNode }[];

export function ServerTabLayout({
  nodesPanel, commandPanel, createPanel, sshKeysPanel, batchPanel, initialPanel = "nodes",
}: {
  nodesPanel: ReactNode;
  commandPanel?: ReactNode;
  createPanel?: ReactNode;
  sshKeysPanel?: ReactNode;
  batchPanel?: ReactNode;
  initialPanel?: PanelKey;
}) {
  const { t } = useI18n();
  const id = useId();
  const [selected, setSelected] = useState<PanelKey>(initialPanel);
  const panels = { nodes: nodesPanel, command: commandPanel, create: createPanel, sshkeys: sshKeysPanel, batch: batchPanel };
  const available = actions.filter((action) => panels[action.key] != null && panels[action.key] !== false);
  const availableKeys = available.map((action) => action.key).join(",");
  const active = available.find((action) => action.key === selected) ?? available[0];

  useEffect(() => {
    const applyHash = () => {
      const key = window.location.hash.replace(/^#servers-/, "") as PanelKey;
      if (availableKeys.split(",").includes(key)) setSelected(key);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [availableKeys]);

  if (!active) return null;
  return (
    <div className="space-y-5">
      <SegmentedTabs
        ariaLabel={t("serversPage.quickActionsAria")}
        value={active.key}
        onChange={(key) => {
          setSelected(key as PanelKey);
          window.history.replaceState(window.history.state, "", `#servers-${key}`);
        }}
        items={available.map((action) => ({
          id: action.key, tabId: `${id}-${action.key}-tab`, panelId: `${id}-${action.key}-panel`,
          label: t(action.labelKey), icon: action.icon,
        }))}
      />
      <div role="tabpanel" id={`${id}-${active.key}-panel`} aria-labelledby={`${id}-${active.key}-tab`} tabIndex={0} className="min-h-48 min-w-0">
        {panels[active.key]}
      </div>
    </div>
  );
}
