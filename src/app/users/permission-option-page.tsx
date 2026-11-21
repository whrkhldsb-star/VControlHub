"use client";

import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

export type StorageNodeInfo = { id: string; name: string; driver: string; basePath: string };
export type ServerInfo = { id: string; name: string; operatingSystem: string; teamId: string | null };
export type IdentityTemplateInfo = { id: string; name: string; isBuiltin: boolean; permissions: string[] };

type Options = { servers: ServerInfo; storageNodes: StorageNodeInfo; identityTemplates: IdentityTemplateInfo };
type Kind = keyof Options;
export type PermissionOptionPage = { [K in Kind]: Options[K][] } & { nextCursor: Record<Kind, string | null> };
const afterParam = { servers: "serverAfter", storageNodes: "storageAfter", identityTemplates: "templateAfter" };

export function readPermissionPage<T = PermissionOptionPage>(
  userId: string, params: Record<string, string>, signal: AbortSignal,
) {
  const query = new URLSearchParams({ userId, pageSize: "25", ...params });
  return csrfFetch<T>(`/api/users/permissions?${query}`, { signal });
}

type PickerPage<K extends Kind> = Record<K, Options[K][]> & Pick<PermissionOptionPage, "nextCursor">;

export function usePermissionOptions<K extends Kind>(
  userId: string, kind: K, label: string, initial: PickerPage<K> | null, selected: Options[K][] = [],
) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [page, setPage] = useState<{
    rows: Options[K][]; nextCursor: string | null; cursors: string[]; filter: Record<string, string>;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const load = async (filter: Record<string, string>, cursors: string[]) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError("");
    try {
      const after = cursors.at(-1);
      const data = await readPermissionPage<PickerPage<K>>(userId, { resource: kind, ...filter, ...(after ? { [afterParam[kind]]: after } : {}) }, controller.signal);
      if (!controller.signal.aborted) setPage({ rows: data[kind], nextCursor: data.nextCursor[kind], cursors, filter });
    } catch (err) {
      if (!controller.signal.aborted) setError(getErrorMessage(err, t("usersPerm.error.loadFailed")));
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };

  const cursors = page?.cursors ?? [];
  const next = page ? page.nextCursor : initial?.nextCursor[kind];
  const rows = page?.rows ?? initial?.[kind] ?? [];
  const options = new Map<string, Options[K]>();
  for (const row of [...rows, ...selected]) options.set(row.id, row);
  const term = input.trim();
  const searchLabel = t("usersPerm.options.query", { resource: label });
  const filtered = Boolean(page?.filter.id || page?.filter.search);
  const controls = (
    <form aria-label={searchLabel} aria-busy={pending} className="my-2 flex flex-wrap items-center gap-2" onSubmit={(event) => {
      event.preventDefault();
      void load(term ? { search: term } : {}, []);
    }}>
      <input type="search" maxLength={120} className={UI_INPUT + " max-w-xs"} value={input}
        aria-label={searchLabel} placeholder={searchLabel}
        onChange={(event) => setInput(event.target.value)} />
      <ActionButton size="sm" variant="secondary" type="submit">{t("usersPerm.options.search")}</ActionButton>
      <ActionButton size="sm" variant="secondary" type="button" disabled={!term} onClick={() => load({ id: term }, [])}>{t("usersPerm.options.byId")}</ActionButton>
      {(next || cursors.length > 0) && <>
        <ActionButton size="sm" variant="secondary" type="button" disabled={pending || !cursors.length}
          onClick={() => load(page?.filter ?? {}, cursors.slice(0, -1))}>{t("common.pagination.previous")}</ActionButton>
        <ActionButton size="sm" variant="secondary" type="button" disabled={pending || !next}
          onClick={() => next && load(page?.filter ?? {}, [...cursors, next])}>{t("common.pagination.next")}</ActionButton>
      </>}
      {pending && <span role="status">{t("common.loading")}</span>}
      {error && <Notice tone="danger" compact>{error}</Notice>}
      {filtered && !pending && !error && !rows.length && <span role="status">{t("usersPerm.options.noResults")}</span>}
    </form>
  );
  return { options: [...options.values()], controls, filtered };
}
