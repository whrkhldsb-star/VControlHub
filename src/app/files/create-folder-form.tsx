"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/use-locale";

import { createFolderAction, type StorageActionState } from "../storage/actions";

import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { ActionButton } from "@/components/action-button";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";
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
  disabled = false,
  onCreated,
}: {
  storageNodes: StorageNodeOption[];
  currentPath: string;
  initialNodeId?: string;
  disabled?: boolean;
  onCreated?: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const refreshPage = router.refresh;
  const defaultNodeId = initialNodeId && storageNodes.some((node) => node.id === initialNodeId)
    ? initialNodeId
    : storageNodes.length > 0 ? storageNodes[0]!.id : "";
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState(defaultNodeId);
  const onCreatedRef = useRef(onCreated);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  }, [onCreated]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, formAction, isPending] = useActionState(createFolderAction, initialState);

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
    if (!disabled) return;
    setExpanded(false);
    setFolderName("");
  }, [disabled]);

  useEffect(() => {
    if (!state.success) return;
    let active = true;
    setRefreshing(true);
    const refreshResult = onCreatedRef.current
      ? onCreatedRef.current()
      : refreshPage();
    void Promise.resolve(refreshResult).finally(() => {
      if (!active) return;
      setExpanded(false);
      setFolderName("");
      setRefreshing(false);
    });
    return () => {
      active = false;
    };
  }, [state, refreshPage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        data-tone="accent"
        className="rounded-lg border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
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
                {node.name} ({getStorageDriverLabel(t, node.driver)})
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
      <ActionButton variant="primary"
        type="submit"
        disabled={disabled || !folderName.trim() || isPending || refreshing}
        data-tone="accent" className="disabled:opacity-50"
      >
        {isPending || refreshing ? t("common.submitting") : t("common.create")}
      </ActionButton>
      <ActionButton variant="secondary"
        onClick={handleCancel} className="!px-4 !py-2 !text-sm">
        {t("common.cancel")}
      </ActionButton>
      {state.error ? (
        <span className="text-xs text-[var(--danger)]">{state.error}</span>
      ) : null}
      {state.success ? (
        <span className="text-xs text-[var(--success)]">{state.success}</span>
      ) : null}
    </form>
  );
}
