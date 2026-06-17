"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/use-locale";

import { createFolderAction, type StorageActionState } from "../storage/actions";

const initialState: StorageActionState = {};

type StorageNodeOption = {
  id: string;
  name: string;
  driver: string;
};

export function CreateFolderForm({
  storageNodes,
  currentPath,
  initialNodeId,
  onCreated,
}: {
  storageNodes: StorageNodeOption[];
  currentPath: string;
  initialNodeId?: string;
  onCreated?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const defaultNodeId = initialNodeId && storageNodes.some((node) => node.id === initialNodeId)
    ? initialNodeId
    : storageNodes.length > 0 ? storageNodes[0]!.id : "";
  const [expanded, setExpanded] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState(defaultNodeId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, formAction] = useActionState(createFolderAction, initialState);

  function handleToggle() {
    setExpanded((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => inputRef.current?.focus(), 0);
      } else {
        setFolderName("");
      }
      return next;
    });
  }

  function handleCancel() {
    setExpanded(false);
    setFolderName("");
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setSelectedNodeId(defaultNodeId);
  }, [defaultNodeId]);

  useEffect(() => {
    if (state.success) {
      router.refresh();
      onCreated?.();
      setExpanded(false);
      setFolderName("");
    }
  }, [state.success, router, onCreated]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={handleToggle}
        data-tone="accent"
        className="rounded-full border px-4 py-2 text-sm font-medium transition"
      >
        {t("common.newFolder")}
      </button>
    );
  }

  const fullPath = currentPath ? `${currentPath}/${folderName}` : folderName;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="currentPath" value={currentPath} />
      {storageNodes.length > 1 ? (
        <label className="grid gap-1 text-sm text-[var(--text-secondary)]">
          <span>目标节点</span>
          <select
            name="storageNodeId"
            value={selectedNodeId}
            onChange={(event) => setSelectedNodeId(event.currentTarget.value)}
            className="rounded-2xl border border-[var(--border)] bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
          >
            {storageNodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}（{node.driver}）
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="storageNodeId" value={selectedNodeId} />
      )}
      <label className="grid gap-1 text-sm text-[var(--text-secondary)]">
        <span>文件夹名称</span>
        <input
          ref={inputRef}
          name="folderName"
          value={folderName}
          onChange={(event) => setFolderName(event.currentTarget.value)}
          required
          minLength={1}
          maxLength={255}
          pattern={String.raw`^[^\s/\\:*?"<>|]+$`}
          placeholder="输入文件夹名"
          className="rounded-2xl border border-[var(--border)] bg-slate-950 px-4 py-2 text-sm text-white placeholder:text-slate-500"
        />
      </label>
      {folderName.trim() ? (
        <span className="text-xs text-[var(--text-secondary)]">{t("common.pathPrefix")}{fullPath}</span>
      ) : null}
      <button
        type="submit"
        disabled={!folderName.trim()}
        data-tone="accent"
        className="rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
      >
        创建
      </button>
      <button
        type="button"
        onClick={handleCancel}
        className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-white/10"
      >
        取消
      </button>
      {state.error ? (
        <span className="text-xs text-rose-300">{state.error}</span>
      ) : null}
      {state.success ? (
        <span className="text-xs text-emerald-300">{state.success}</span>
      ) : null}
    </form>
  );
}
