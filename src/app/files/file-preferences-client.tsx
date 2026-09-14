"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Star, Tag, X, RefreshCw } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { buildSearchHref } from "./file-entry-utils";

type Preference = {
  fileEntryId: string;
  favorite: boolean;
  tags: string[];
  lastOpenedAt: string | null;
  fileEntry: {
    name: string;
    relativePath: string;
    storageNodeId: string;
    entryType: string;
    storageNode: { name: string };
  };
};
type Page = { items: Preference[]; nextCursor: string | null };

export function recordFileOpen(fileEntryId: string) {
  void csrfFetch("/api/files/preferences", {
    method: "PATCH",
    body: JSON.stringify({ fileEntryId, opened: true }),
  }).catch(() => undefined);
}

export function FilePreferenceButton({ fileEntryId }: { fileEntryId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void csrfFetch<Page>("/api/files/preferences", {
      params: { mode: "entry", fileEntryId },
      signal: controller.signal,
    })
      .then((page) => {
        setFavorite(page.items[0]?.favorite ?? false);
        setTags(page.items[0]?.tags.join(", ") ?? "");
        setLoaded(true);
        setError("");
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [open, fileEntryId, reload]);
  return (
    <>
      <button
        type="button"
        title={t("filePreferences.edit")}
        aria-label={t("filePreferences.edit")}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)]"
        onClick={() => {
          setLoaded(false);
          setOpen(true);
        }}
      >
        <Star size={15} fill={favorite ? "currentColor" : "none"} />
      </button>
      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        busy={busy}
        label={t("filePreferences.edit")}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t("filePreferences.edit")}</h2>
          <button
            type="button"
            aria-label={t("common.close")}
            disabled={busy}
            onClick={() => setOpen(false)}
            className="p-2"
          >
            <X size={18} />
          </button>
        </div>
        {error ? (
          <Notice tone="danger">
            {error}
            <button
              type="button"
              aria-label={t("storageUpload.retry")}
              onClick={() => setReload((value) => value + 1)}
              className="p-2"
            >
              <RefreshCw size={16} />
            </button>
          </Notice>
        ) : null}
        <form
          className="mt-4 grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !loaded) return;
            setBusy(true);
            setError("");
            try {
              await csrfFetch("/api/files/preferences", {
                method: "PATCH",
                body: JSON.stringify({
                  fileEntryId,
                  favorite,
                  tags: tags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                }),
              });
              setOpen(false);
              window.dispatchEvent(new Event("file-preferences-changed"));
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : t("filePreferences.failed"),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={favorite}
              disabled={busy || !loaded}
              onChange={(event) => setFavorite(event.currentTarget.checked)}
            />
            {t("filePreferences.favorite")}
          </label>
          <label className="grid gap-2 text-sm">
            <span>{t("filePreferences.tags")}</span>
            <input
              className={UI_INPUT}
              value={tags}
              disabled={busy || !loaded}
              maxLength={406}
              placeholder={t("filePreferences.tagsPlaceholder")}
              onChange={(event) => setTags(event.currentTarget.value)}
            />
          </label>
          <ActionButton type="submit" disabled={busy || !loaded}>
            {t(busy ? "common.executing" : "common.save")}
          </ActionButton>
        </form>
      </ModalShell>
    </>
  );
}

export function FileCollections() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"favorites" | "recent" | "tags">(
    "favorites",
  );
  const [tag, setTag] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState<Page>({ items: [], nextCursor: null });
  const [cursor, setCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => {
    setCursor(undefined);
    setReload((value) => value + 1);
  }, []);
  useEffect(() => {
    window.addEventListener("file-preferences-changed", refresh);
    return () =>
      window.removeEventListener("file-preferences-changed", refresh);
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      setError("");
      void csrfFetch<Page>("/api/files/preferences", {
        params: {
          mode,
          ...(filter ? { tag: filter } : {}),
          ...(cursor ? { cursor } : {}),
        },
        signal: controller.signal,
      })
        .then(setPage)
        .catch((error: Error) => {
          if (!controller.signal.aborted) setError(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, mode, filter, cursor, reload]);
  return (
    <>
      <ActionButton variant="outline" onClick={() => setOpen(true)}>
        <Star size={16} />
        {t("filePreferences.collections")}
      </ActionButton>
      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        label={t("filePreferences.collections")}
        panelClassName="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--modal-bg)] p-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("filePreferences.collections")}</h2>
          <button
            type="button"
            className="p-2"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div
          role="tablist"
          aria-label={t("filePreferences.collections")}
          className="my-4 flex border-b border-[var(--border)]"
        >
          {(["favorites", "recent", "tags"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              className={`px-3 py-2 text-sm ${mode === value ? "border-b-2 border-[var(--color-action)]" : "text-[var(--text-muted)]"}`}
              onClick={() => {
                setMode(value);
                setCursor(undefined);
                setPage({ items: [], nextCursor: null });
              }}
            >
              {t(`filePreferences.${value}`)}
            </button>
          ))}
        </div>
        {mode === "tags" ? (
          <form
            className="mb-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setFilter(tag.trim());
              setCursor(undefined);
            }}
          >
            <input
              aria-label={t("filePreferences.tags")}
              className={UI_INPUT}
              value={tag}
              maxLength={32}
              onChange={(event) => setTag(event.currentTarget.value)}
            />
            <button
              type="submit"
              aria-label={t("filesBrowserSpa.searchLabel")}
              className="p-2"
            >
              <Tag size={18} />
            </button>
          </form>
        ) : null}
        {error ? (
          <Notice tone="danger">
            {error}
            <button
              type="button"
              onClick={refresh}
              aria-label={t("storageUpload.retry")}
              className="p-2"
            >
              <RefreshCw size={16} />
            </button>
          </Notice>
        ) : null}
        {busy ? (
          <p role="status" className="py-4 text-sm">
            {t("filesBrowserSpa.loading")}
          </p>
        ) : !page.items.length ? (
          <p className="py-6 text-sm text-[var(--text-muted)]">
            {t("filePreferences.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {page.items.map((item) => (
              <li
                key={item.fileEntryId}
                className="flex min-w-0 items-center gap-3 py-3"
              >
                <Link
                  onClick={() => {
                    recordFileOpen(item.fileEntryId);
                    setOpen(false);
                  }}
                  href={buildSearchHref(
                    item.fileEntry.entryType === "DIRECTORY"
                      ? item.fileEntry.relativePath
                      : item.fileEntry.relativePath
                          .split("/")
                          .slice(0, -1)
                          .join("/"),
                    {
                      nodeId: item.fileEntry.storageNodeId,
                      ...(item.fileEntry.entryType === "DIRECTORY"
                        ? {}
                        : { q: item.fileEntry.name }),
                    },
                  )}
                  className="min-w-0 flex-1"
                >
                  <p className="break-all text-sm font-medium">
                    {item.fileEntry.name}
                  </p>
                  <p className="break-all text-xs text-[var(--text-muted)]">
                    {item.fileEntry.storageNode.name} /{" "}
                    {item.fileEntry.relativePath}
                  </p>
                  <p className="break-words text-xs text-[var(--color-action)]">
                    {item.tags.join(" · ")}
                  </p>
                </Link>
                <FilePreferenceButton fileEntryId={item.fileEntryId} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-2">
          {cursor ? (
            <ActionButton
              variant="outline"
              disabled={busy}
              onClick={() => setCursor(undefined)}
            >
              {t("filePreferences.firstPage")}
            </ActionButton>
          ) : null}
          {page.nextCursor ? (
            <ActionButton
              variant="outline"
              disabled={busy}
              onClick={() => setCursor(page.nextCursor ?? undefined)}
            >
              {t("filePreferences.nextPage")}
            </ActionButton>
          ) : null}
        </div>
      </ModalShell>
    </>
  );
}
