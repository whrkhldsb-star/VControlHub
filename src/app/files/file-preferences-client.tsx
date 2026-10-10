"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { Star, Tag } from "@/components/icons";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/page-shell";
import { ActionButton } from "@/components/action-button";
import { CheckboxField, FormField, IconButton, InlineLoading, Notice, SegmentedTabs } from "@/components/ui-primitives";
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
  const formId = useId();
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
      <IconButton
        label={t("filePreferences.edit")}
        tone={favorite ? "accent" : "neutral"}
        className="h-8 w-8"
        onClick={() => {
          setLoaded(false);
          setOpen(true);
        }}
      >
        <Star size={15} fill={favorite ? "currentColor" : "none"} aria-hidden />
      </IconButton>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        busy={busy}
        title={t("filePreferences.edit")}
        footer={<>
          <ActionButton variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </ActionButton>
          <ActionButton type="submit" form={formId} loading={busy} disabled={!loaded}>
            {t(busy ? "common.executing" : "common.save")}
          </ActionButton>
        </>}
      >
        {error ? (
          <Notice tone="danger" className="mb-4" action={{ label: t("storageUpload.retry"), onClick: () => setReload((value) => value + 1) }}>
            {error}
          </Notice>
        ) : null}
        <form
          id={formId}
          className="grid gap-4"
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
          <CheckboxField
            label={t("filePreferences.favorite")}
            checked={favorite}
            disabled={busy || !loaded}
            onChange={(event) => setFavorite(event.currentTarget.checked)}
          />
          <FormField label={t("filePreferences.tags")} htmlFor={`${formId}-tags`}>
            <input
              id={`${formId}-tags`}
              className={UI_INPUT}
              value={tags}
              disabled={busy || !loaded}
              maxLength={406}
              placeholder={t("filePreferences.tagsPlaceholder")}
              onChange={(event) => setTags(event.currentTarget.value)}
            />
          </FormField>
        </form>
      </Dialog>
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
      <ActionButton variant="outline" icon={<Star aria-hidden />} onClick={() => setOpen(true)}>
        {t("filePreferences.collections")}
      </ActionButton>
      <Dialog
        size="xl"
        open={open}
        onClose={() => setOpen(false)}
        title={t("filePreferences.collections")}
        footer={cursor || page.nextCursor ? <>
          {cursor ? (
            <ActionButton variant="secondary" disabled={busy} onClick={() => setCursor(undefined)}>
              {t("filePreferences.firstPage")}
            </ActionButton>
          ) : null}
          {page.nextCursor ? (
            <ActionButton variant="secondary" disabled={busy} onClick={() => setCursor(page.nextCursor ?? undefined)}>
              {t("filePreferences.nextPage")}
            </ActionButton>
          ) : null}
        </> : undefined}
      >
        <SegmentedTabs
          ariaLabel={t("filePreferences.collections")}
          className="mb-4"
          value={mode}
          onChange={(value) => {
            setMode(value as typeof mode);
            setCursor(undefined);
            setPage({ items: [], nextCursor: null });
          }}
          items={(["favorites", "recent", "tags"] as const).map((value) => ({ id: value, label: t(`filePreferences.${value}`) }))}
        />
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
            <ActionButton type="submit" variant="secondary" square aria-label={t("filesBrowserSpa.searchLabel")}>
              <Tag aria-hidden />
            </ActionButton>
          </form>
        ) : null}
        {error ? (
          <Notice tone="danger" className="mb-3" action={{ label: t("storageUpload.retry"), onClick: refresh }}>
            {error}
          </Notice>
        ) : null}
        {busy ? (
          <InlineLoading label={t("filesBrowserSpa.loading")} className="py-4" />
        ) : !page.items.length ? (
          <EmptyState text={t("filePreferences.empty")} />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
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
                  <p className="break-words text-xs text-[var(--accent)]">
                    {item.tags.join(" · ")}
                  </p>
                </Link>
                <FilePreferenceButton fileEntryId={item.fileEntryId} />
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}
