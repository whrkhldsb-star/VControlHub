import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { PaginatedList } from "../paginated-list";

describe("PaginatedList", () => {
  it("keeps long operational histories usable without truncating records", async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <PaginatedList pageSize={2}>
        <div>记录 1</div><div>记录 2</div><div>记录 3</div>
      </PaginatedList>,
      { locale: "zh" },
    );

    expect(screen.getByText("记录 1")).toBeVisible();
    expect(screen.queryByText("记录 3")).not.toBeInTheDocument();
    expect(screen.getByText("显示第 1-2 项，共 3 项")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("记录 3")).toBeVisible();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  });

  it("returns to the first page when a filter changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithI18n(
      <PaginatedList pageSize={1} resetKey="all"><div>全部 1</div><div>全部 2</div></PaginatedList>,
      { locale: "zh" },
    );

    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("全部 2")).toBeVisible();

    rerender(<PaginatedList pageSize={1} resetKey="filtered"><div>筛选 1</div><div>筛选 2</div></PaginatedList>);
    expect(await screen.findByText("筛选 1")).toBeVisible();
    expect(screen.queryByText("筛选 2")).not.toBeInTheDocument();
  });
});
