"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/use-locale";

import { createFolderAction, type StorageActionState } from "../storage/actions";

import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
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
  onCreated?: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const refreshPage = router.refresh;
  const defaultNodeId = initialNodeId && storageNodes.some((node) => node.id === initialNodeId)
    ? initialNodeId
    : storageNodes.length > 0 ? storageNodes[0]!.id : "";
  const [expanded, setExpanded] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState(defaultNodeId);
  const onCreatedRef = useRef(onCreated);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  }, [onCreated]);
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
      setExpanded(false);
      setFolderName("");
      if (onCreatedRef.current) {
        void onCreatedRef.current();
      } else {
        refreshPage();
      }
    }
  }, [state.success, refreshPage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={handleToggle}
        data-tone="accent"
        className="rounded-lg border px-4 py-2 text-sm font-medium transition"
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
          <span>{t("common.targetNode")}</span>
          <select
            name="storageNodeId"
            value={selectedNodeId}
            onChange={(event) => setSelectedNodeId(event.currentTarget.value)}
            className={cn(UI_INPUT, "rounded-2xl")}
          >
            {storageNodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name} ({node.driver})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="storageNodeId" value={selectedNodeId} />
      )}
      <label className="grid gap-1 text-sm text-[var(--text-secondary)]">
        <span>{t("common.folderName")}</span>
        <input
          ref={inputRef}
          name="folderName"
          value={folderName}
          onChange={(event) => setFolderName(event.currentTarget.value)}
          required
          minLength={1}
          maxLength={255}
          pattern={String.raw`^[^\s/\\:*?"<>|]+$`}
          placeholder={t("common.folderNamePlaceholder")}
          className={cn(UI_INPUT, "rounded-2xl")}
        />
      </label>
      {folderName.trim() ? (
        <span className="text-xs text-[var(--text-secondary)]">{t("common.pathPrefix")}{fullPath}</span>
      ) : null}
      <button
        type="submit"
        disabled={!folderName.trim()}
        data-tone="accent"
        className="rounded-lg border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("common.create")}
      </button>
      <button
        type="button"
        onClick={handleCancel}
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10"
      >
        {t("common.cancel")}
      </button>
      {state.error ? (
        <span className="text-xs text-[var(--danger)]">{state.error}</span>
      ) : null}
      {state.success ? (
        <span className="text-xs text-[var(--success)]">{state.success}</span>
      ) : null}
    </form>
  );
}
