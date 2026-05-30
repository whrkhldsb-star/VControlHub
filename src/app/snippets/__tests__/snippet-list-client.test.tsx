import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { ToastProvider } from "@/components/toast-provider";
import { SnippetList } from "../snippet-list-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const snippets = [
  {
    id: "snip-1",
    title: "部署脚本",
    content: "npm run build",
    language: "bash",
    description: "构建命令",
    tags: ["deploy"],
    isPrivate: false,
  },
];

function renderList() {
  return render(
    <ToastProvider>
      <SnippetList snippets={snippets} />
    </ToastProvider>,
  );
}

describe("SnippetList", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(csrfFetch).mockResolvedValue({});
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn() },
    });
  });

  it("uses an accessible confirmation dialog instead of native confirm before deleting", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "删除代码片段 部署脚本" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "删除代码片段" })).toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalled();
  });

  it("deletes only after modal confirmation and shows success feedback", async () => {
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "删除代码片段 部署脚本" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/snippets?id=snip-1", { method: "DELETE" }));
    expect(screen.queryByText("部署脚本")).not.toBeInTheDocument();
    expect(screen.getByText("代码片段已删除")).toBeInTheDocument();
  });

  it("keeps the dialog open and displays API errors", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("删除失败"));
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "删除代码片段 部署脚本" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("删除失败");
    expect(screen.getByRole("dialog", { name: "删除代码片段" })).toBeInTheDocument();
    expect(screen.getAllByText("部署脚本").length).toBeGreaterThanOrEqual(1);
  });
});
