import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { ServerInventory } from "../server-inventory";
import type { ServerInventoryData } from "@/lib/server/inventory";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../server-overview-card", () => ({ ServerOverviewCard: ({ server }: { server: { name: string } }) => <article>{server.name}</article> }));
const inventory = { servers: [{ id: "node-512", name: "Node beyond old limit" }], stats: { total: 600, matching: 600, enabled: 300, storage: 0 }, query: { query: "", status: "all", mode: "all", page: 2 }, pageSize: 12 } as ServerInventoryData;
beforeEach(() => { push.mockReset(); window.history.replaceState({}, "", "/servers?page=2#servers-nodes"); });
describe("server inventory navigation", () => {
  it("uses server counts and preserves panel location while paging", () => {
    renderWithI18n(<ServerInventory inventory={inventory} canManageServers canUseSshTerminal />);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(push).toHaveBeenCalledWith("/servers?page=3#servers-nodes", { scroll: false });
  });
  it("submits a search and resets the page without filtering the current slice", () => {
    renderWithI18n(<ServerInventory inventory={inventory} canManageServers canUseSshTerminal />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " Production " } });
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "搜索名称、主机或标签" }));
    expect(push).toHaveBeenCalledWith("/servers?query=Production#servers-nodes", { scroll: false });
  });
  it("keeps filters available after an empty result and resets them", () => {
    renderWithI18n(<ServerInventory inventory={{ ...inventory, servers: [], stats: { ...inventory.stats, matching: 0 }, query: { query: "none", status: "disabled", mode: "AGENT", page: 1 } }} canManageServers canUseSshTerminal />);
    expect(screen.getByText("没有匹配的节点")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(push).toHaveBeenCalledWith("/servers#servers-nodes", { scroll: false });
  });
});
