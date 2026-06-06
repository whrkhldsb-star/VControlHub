"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const defaultNodeId = initialNodeId && storageNodes.some((node) => node.id === initialNodeId)
    ? initialNodeId
    : storageNodes.length > 0 ? storageNodes[0].id : "";
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
        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 light:text-cyan-900 transition hover:bg-cyan-400/20"
      >
        新建文件夹
      </button>
    );
  }

  const fullPath = currentPath ? `${currentPath}/${folderName}` : folderName;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="currentPath" value={currentPath} />
      {storageNodes.length > 1 ? (
        <label className="grid gap-1 text-sm text-slate-300 light:text-slate-700">
          <span className="sr-only">目标节点</span>
          <select
            name="storageNodeId"
            value={selectedNodeId}
            onChange={(event) => setSelectedNodeId(event.currentTarget.value)}
            className="rounded-2xl border border-white/10 light:border-slate-200 bg-slate-950 light:bg-white px-3 py-2 text-sm text-white light:text-slate-900 focus:border-cyan-400/50 focus:outline-none"
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
      <label className="grid gap-1 text-sm text-slate-300 light:text-slate-700">
        <span className="sr-only">文件夹名称</span>
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
          className="rounded-2xl border border-white/10 light:border-slate-200 bg-slate-950 light:bg-white px-4 py-2 text-sm text-white light:text-slate-900 placeholder:text-slate-500 light:placeholder:text-slate-400"
        />
      </label>
      {folderName.trim() ? (
        <span className="text-xs text-slate-400 light:text-slate-600">路径：/{fullPath}</span>
      ) : null}
      <button
        type="submit"
        disabled={!folderName.trim()}
        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 light:text-cyan-900 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        创建
      </button>
      <button
        type="button"
        onClick={handleCancel}
        className="rounded-full border border-white/10 light:border-slate-200 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 light:text-slate-700 transition hover:bg-white/10"
      >
        取消
      </button>
      {state.error ? (
        <span className="text-xs text-rose-300">{state.error}</span>
      ) : null}
      {state.success ? (
        <span className="text-xs text-emerald-300 light:text-emerald-700">{state.success}</span>
      ) : null}
    </form>
  );
}
