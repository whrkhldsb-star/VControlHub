"use client";

import { useState, useMemo, useId } from "react";

import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import {
  type NodeOption,
  getNodeLabel,
} from "./files-browser-helpers";
import { Server, HardDrive } from "@/components/icons";

function NodeDriverIcon({ driver, size = 14 }: { driver: string; size?: number }) {
  return driver === "SFTP" ? (
    <Server size={size} className="inline -mt-0.5 text-[var(--text-secondary)]" aria-hidden="true" />
  ) : (
    <HardDrive size={size} className="inline -mt-0.5 text-[var(--text-secondary)]" aria-hidden="true" />
  );
}

export function NodeFilterSelect({
  t,
  nodes,
  value,
  onChange,
  compact = false,
}: {
  t: (k: string) => string;
  nodes: NodeOption[];
  value: string;
  onChange: (nodeId: string) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchInputId = useId();
  const selectInputId = useId();
  const selectedNode = nodes.find((node) => node.id === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredNodes = useMemo(() => {
    if (!normalizedQuery) return nodes;
    return nodes.filter((node) => {
      const haystack = `${node.name} ${node.driver} ${node.id}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [nodes, normalizedQuery]);

  return (
    <div className={compact ? "space-y-2" : "w-full max-w-xl space-y-2"}>
      <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
        <span>
          {t("filesBrowserSpa.currentSelectionLabel")}{selectedNode ? <NodeDriverIcon driver={selectedNode.driver} /> : null}{" "}
          {getNodeLabel(t, selectedNode)}
        </span>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-[var(--color-action)] hover:text-[var(--text-primary)] light:hover:text-[var(--accent)] light:hover:text-[var(--accent)]"
          >
            {t("filesBrowserSpa.clear")}
          </button>
        ) : null}
      </div>
      <div className="space-y-1">
        <label htmlFor={searchInputId} className="block text-xs font-medium text-[var(--text-secondary)]">
          {t("filesBrowserSpa.searchStorageNode")}
        </label>
        <input
          id={searchInputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("filesBrowserSpa.searchPlaceholder")}
          className={cn(UI_INPUT, "rounded-2xl")}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={selectInputId} className="block text-xs font-medium text-[var(--text-secondary)]">
          {t("filesBrowserSpa.selectStorageNode")}
        </label>
        <select
          id={selectInputId}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className={cn(UI_INPUT, "rounded-2xl border-[var(--color-action-border)]/30 light:border-[var(--color-action-border)]/40")}
        >
          <option value="">{t("filesBrowserSpa.allNodesOption")}</option>
          {filteredNodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name} ({node.driver})
            </option>
          ))}
        </select>
      </div>
      {filteredNodes.length === 0 ? (
        <p className="text-xs text-[var(--warning)]">
          {t("filesBrowserSpa.noMatchingNode")}
        </p>
      ) : null}
    </div>
  );
}
