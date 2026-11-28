"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, ButtonLink } from "@/components/action-button";
import { aiServerHref, directCommandHref } from "@/lib/ui/deep-links";
import { Search, X } from "@/components/icons";
import { EmptyState, Toolbar } from "@/components/page-shell";
import { Pagination } from "@/components/pagination";
import { IconButton, SegmentedTabs } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { useI18n } from "@/lib/i18n/use-locale";
import { ServerOverviewCard } from "./server-overview-card";
import type { InventoryQuery, ServerInventoryData } from "@/lib/server/inventory";

export function ServerInventory({ inventory, canManageServers, canUseSshTerminal, canRun, canAskAi }: {
  canRun?: boolean; canAskAi?: boolean;
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
  const filtered = Boolean(query.query || query.status !== "all" || query.mode !== "all" || operatingSystem !== "all");
  const clear = () => navigate({ query: "", status: "all", mode: "all", operatingSystem: "all", page: 1 });
  return <div className="space-y-4" aria-busy={pending}>
    {stats.total > 0 && <SegmentedTabs
      ariaLabel={t("serversPage.windows.os")}
      value={operatingSystem}
      onChange={(os) => navigate({ operatingSystem: os as InventoryQuery["operatingSystem"], page: 1 })}
      variant="pills"
      items={(["all", "LINUX", "WINDOWS"] as const).map((os) => ({
        id: os,
        label: os === "all" ? t("serversPage.windows.all") : os === "LINUX" ? "Linux" : "Windows",
        disabled: pending,
      }))}
    />}
    {stats.total > 0 && <Toolbar>
      <form key={query.query} className="flex min-w-0 flex-1 basis-64 gap-2" onSubmit={(event) => {
        event.preventDefault();
        navigate({ query: String(new FormData(event.currentTarget).get("query") ?? "").trim(), page: 1 });
      }}>
        <input type="search" name="query" maxLength={200} aria-label={t("serversPage.inventory.search")}
          placeholder={t("serversPage.inventory.search")} className={UI_INPUT} onChange={event => { if (!event.target.value && query.query) navigate({ query: "", page: 1 }); }} defaultValue={query.query} />
        <IconButton type="submit" className="!h-auto w-10 self-stretch shrink-0" disabled={pending} label={t("serversPage.inventory.search")}><Search size={18} aria-hidden /></IconButton>
      </form>
      <select disabled={pending} aria-label={t("serversPage.inventory.status")} className={`${UI_INPUT} sm:!w-auto`} value={query.status}
        onChange={(event) => navigate({ status: event.target.value as InventoryQuery["status"], page: 1 })}>
        <option value="all">{t("serversPage.inventory.allStatuses")}</option><option value="enabled">{t("serversPage.inventory.enabled")}</option><option value="disabled">{t("serverOverviewCard.disabled")}</option>
      </select>
      <select disabled={pending} aria-label={t("serversPage.management.title")} className={`${UI_INPUT} sm:!w-auto`} value={query.mode}
        onChange={(event) => navigate({ mode: event.target.value as InventoryQuery["mode"], page: 1 })}>
        <option value="all">{t("serversPage.inventory.allModes")}</option><option value="DIRECT">{t("serversPage.management.directAny")}</option><option value="AGENT">{t("serversPage.management.agent")}</option>
      </select>
      {filtered && servers.length > 0 && <IconButton disabled={pending} label={t("serversPage.inventory.clear")} onClick={clear}><X size={18} aria-hidden /></IconButton>}
    </Toolbar>}
    <section aria-label={t("serversPage.overview.aria")} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {servers.map((server) => <div key={server.id} className="min-w-0 space-y-2">
        <ServerOverviewCard server={server} canManageServers={canManageServers} canUseSshTerminal={canUseSshTerminal} />
        <div className="flex flex-wrap gap-2">{canRun && <ButtonLink variant="secondary" size="sm" href={directCommandHref({ serverId: server.id })}>{t("commandsPage.title")}</ButtonLink>}
          {canAskAi && <ButtonLink variant="outline" size="sm" href={aiServerHref(server.id)}>{t("serversPage.askAi")}</ButtonLink>}</div>
      </div>)}
      {servers.length === 0 && <div className="col-span-full"><EmptyState title={filtered ? t("serversPage.inventory.noResults") : undefined} action={filtered && <ActionButton variant="secondary" onClick={clear}>{t("serversPage.inventory.clear")}</ActionButton>} text={filtered ? undefined : t(stats.total ? "serversPage.inventory.noResults" : canManageServers ? "serversPage.overview.empty" : "serversPage.readEmpty")} /></div>}
    </section>
    {stats.total > 0 && <Pagination page={query.page} pageSize={pageSize} totalItems={stats.matching} loading={pending} onPageChange={(page) => navigate({ page })} />}
  </div>;
}
