"use client";

import { useTransition } from "react";
import { ActionButton } from "@/components/action-button";
import { useRouter } from "next/navigation";
import { Search, X } from "@/components/icons";
import { EmptyState, Toolbar } from "@/components/page-shell";
import { Pagination } from "@/components/pagination";
import { IconButton } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { useI18n } from "@/lib/i18n/use-locale";
import { ServerOverviewCard } from "./server-overview-card";
import type { InventoryQuery, ServerInventoryData } from "@/lib/server/inventory";

export function ServerInventory({ inventory, canManageServers, canUseSshTerminal }: {
  inventory: ServerInventoryData; canManageServers: boolean; canUseSshTerminal: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { servers, stats, query, pageSize } = inventory;
  const operatingSystem = (query as InventoryQuery & { operatingSystem?: string }).operatingSystem ?? "all";
  const navigate = (change: Partial<InventoryQuery> & { operatingSystem?: string }) => {
    const next = { ...query, ...change };
    const url = new URL(window.location.href);
    for (const [name, value] of Object.entries(next)) {
      if (value === "" || value === "all" || (name === "page" && value === 1)) url.searchParams.delete(name);
      else url.searchParams.set(name, String(value));
    }
    startTransition(() => router.push(`${url.pathname}${url.search}${url.hash}`, { scroll: false }));
  };
  return <div className="space-y-4" aria-busy={pending}>
    <div role="tablist" aria-label={t("serversPage.windows.os")} className="flex gap-2">
      {(["all", "LINUX", "WINDOWS"] as const).map((os) => <ActionButton key={os} role="tab" aria-selected={operatingSystem === os} disabled={pending} variant={operatingSystem === os ? "primary" : "secondary"} onClick={() => navigate({ operatingSystem: os, page: 1 })}>{os === "all" ? t("serversPage.windows.all") : os === "LINUX" ? "Linux" : "Windows"}</ActionButton>)}
    </div>
    {stats.total > 0 && <Toolbar className="!mb-0">
      <form key={query.query} className="flex min-w-0 flex-1 basis-64 gap-2" onSubmit={(event) => {
        event.preventDefault();
        navigate({ query: String(new FormData(event.currentTarget).get("query") ?? "").trim(), page: 1 });
      }}>
        <input type="search" name="query" maxLength={200} aria-label={t("serversPage.inventory.search")}
          placeholder={t("serversPage.inventory.search")} className={UI_INPUT} defaultValue={query.query} />
        <IconButton type="submit" className="h-10 w-10 shrink-0" disabled={pending} label={t("serversPage.inventory.search")}><Search size={18} aria-hidden /></IconButton>
      </form>
      <select disabled={pending} aria-label={t("serversPage.inventory.status")} className={`${UI_INPUT} sm:!w-auto`} value={query.status}
        onChange={(event) => navigate({ status: event.target.value as InventoryQuery["status"], page: 1 })}>
        <option value="all">{t("serversPage.inventory.allStatuses")}</option><option value="enabled">{t("serversPage.inventory.enabled")}</option><option value="disabled">{t("serverOverviewCard.disabled")}</option>
      </select>
      <select disabled={pending} aria-label={t("serversPage.management.title")} className={`${UI_INPUT} sm:!w-auto`} value={query.mode}
        onChange={(event) => navigate({ mode: event.target.value as InventoryQuery["mode"], page: 1 })}>
        <option value="all">{t("serversPage.inventory.allModes")}</option><option value="DIRECT">{t("serversPage.management.direct")}</option><option value="AGENT">{t("serversPage.management.agent")}</option>
      </select>
      {(query.query || query.status !== "all" || query.mode !== "all") && <IconButton disabled={pending} label={t("serversPage.inventory.clear")} onClick={() => navigate({ query: "", status: "all", mode: "all", page: 1 })}><X size={18} aria-hidden /></IconButton>}
    </Toolbar>}
    <section aria-label={t("serversPage.overview.aria")} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {servers.map((server) => <ServerOverviewCard key={server.id} server={server} canManageServers={canManageServers} canUseSshTerminal={canUseSshTerminal} />)}
      {servers.length === 0 && <div className="col-span-full"><EmptyState text={t(stats.total ? "serversPage.inventory.noResults" : "serversPage.overview.empty")} /></div>}
    </section>
    {stats.total > 0 && <Pagination page={query.page} pageSize={pageSize} totalItems={stats.matching} loading={pending} onPageChange={(page) => navigate({ page })} />}
  </div>;
}
