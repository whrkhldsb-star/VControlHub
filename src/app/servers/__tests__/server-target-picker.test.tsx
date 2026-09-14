import { useState } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { ServerTargetPicker, type ServerTarget } from "../server-target-picker";

const load = vi.hoisted(() => vi.fn());
vi.mock("../inventory-actions", () => ({ loadServerOperationTargets: load }));
const rows: ServerTarget[] = Array.from({ length: 25 }, (_, i) => ({ id: `node-${i}`, name: `Node ${i}`, host: `host-${i}`, enabled: true, available: true, reason: null }));
function Harness({ submit = vi.fn() }: { submit?: () => void }) {
  const [selected, setSelected] = useState<ServerTarget[]>([]);
  return <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <ServerTargetPicker kind="command" selected={selected} onChange={setSelected} />
    <output data-testid="selection">{selected.map((row) => row.id).join(",")}</output>
  </form>;
}
beforeEach(() => {
  load.mockReset().mockImplementation(async (_kind, query) => ({
    rows: query.query ? rows.slice(24) : query.page === 2 ? rows.slice(24) : rows.slice(0, 24),
    total: query.query ? 1 : 25, page: query.page, pageSize: 24, enabledCount: 25,
  }));
});
it("retains selections across pages and limits select-page to the current slice", async () => {
  renderWithI18n(<Harness />);
  await screen.findByRole("checkbox", { name: /Node 0\s*host-0/ });
  fireEvent.click(screen.getByRole("button", { name: "选择本页" }));
  expect(screen.getByTestId("selection").textContent?.split(",")).toHaveLength(24);
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /Node 24\s*host-24/ }));
  expect(screen.getByTestId("selection").textContent?.split(",")).toHaveLength(25);
  fireEvent.click(screen.getByRole("button", { name: "上一页" }));
  expect(await screen.findByRole("checkbox", { name: /Node 0\s*host-0/ })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "取消本页选择" }));
  expect(screen.getByTestId("selection")).toHaveTextContent("node-24");
});
it("searches with Enter without submitting the surrounding command form", async () => {
  const submit = vi.fn();
  renderWithI18n(<Harness submit={submit} />);
  await screen.findByRole("checkbox", { name: /Node 0\s*host-0/ });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "host-24" } });
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
  await screen.findByRole("checkbox", { name: /Node 24\s*host-24/ });
  expect(load).toHaveBeenLastCalledWith("command", { query: "host-24", page: 1 });
  expect(submit).not.toHaveBeenCalled();
});
it("offers a retry after loading fails", async () => {
  load.mockRejectedValueOnce(new Error("temporary"));
  renderWithI18n(<Harness />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: /重试/ }));
  await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(24));
});
