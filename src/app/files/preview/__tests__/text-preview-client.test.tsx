import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { TextPreviewClient } from "../text-preview-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

describe("TextPreviewClient editable mode", () => {
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
  });

  it("requires diff review confirmation before saving edited file content", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({
        draft: {
          content: "alpha\nbeta\n",
          byteSize: 11,
          updatedAt: "2026-06-08T01:02:03.000Z",
          lastModifiedMs: 1780880523000,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        file: {
          byteSize: 17,
          previousByteSize: 11,
          updatedAt: "2026-06-08T01:03:03.000Z",
          lastModifiedMs: 1780880583000,
        },
      });

    render(<TextPreviewClient href="/download/readme.txt" name="readme.txt" fileEntryId="file_1" editable />);

    expect(await screen.findByText("可在线编辑 · 保存会校验并发修改")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "编辑" }));
    const editor = screen.getByRole("textbox", { name: "在线编辑文件内容" });
    fireEvent.change(editor, { target: { value: "alpha\ngamma\ndelta\n" } });

    await actor.click(screen.getByRole("button", { name: "预览并保存" }));

    const dialog = screen.getByRole("dialog", { name: "保存前差异预览" });
    expect(dialog).toHaveTextContent("新增 1 行，删除 0 行，修改 2 行");
    expect(dialog).toHaveTextContent("L2 · 修改");
    expect(dialog).toHaveTextContent("- beta");
    expect(dialog).toHaveTextContent("+ gamma");
    expect(csrfFetch).toHaveBeenCalledTimes(1);

    await actor.click(screen.getByRole("button", { name: "确认保存" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/files/editable/file_1", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        content: "alpha\ngamma\ndelta\n",
        expectedUpdatedAt: "2026-06-08T01:02:03.000Z",
        expectedLastModifiedMs: 1780880523000,
      }),
    })));
    expect(await screen.findByRole("status")).toHaveTextContent("已保存 17 B");
    expect(screen.queryByRole("dialog", { name: "保存前差异预览" })).not.toBeInTheDocument();
  });

  it("surfaces stale draft conflicts without closing the editor", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({
        draft: {
          content: "alpha\nbeta\n",
          byteSize: 11,
          updatedAt: "2026-06-08T01:02:03.000Z",
          lastModifiedMs: 1780880523000,
        },
      })
      .mockRejectedValueOnce(new Error("文件内容已在磁盘上发生变化，请重新加载后再保存"));

    render(<TextPreviewClient href="/download/readme.txt" name="readme.txt" fileEntryId="file_1" editable />);

    await screen.findByText("可在线编辑 · 保存会校验并发修改");
    await actor.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "在线编辑文件内容" }), { target: { value: "alpha\nchanged\n" } });
    await actor.click(screen.getByRole("button", { name: "预览并保存" }));
    expect(screen.getByRole("dialog", { name: "保存前差异预览" })).toHaveTextContent("保存时会校验打开草稿后的文件时间戳");

    await actor.click(screen.getByRole("button", { name: "确认保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("文件内容已在磁盘上发生变化，请重新加载后再保存");
    expect(screen.getByRole("textbox", { name: "在线编辑文件内容" })).toHaveValue("alpha\nchanged\n");
  });

  it("shows visible labels for search and line jump controls", async () => {
    const actor = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "alpha\nbeta\ngamma\n",
    }));

    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<TextPreviewClient href="/download/readme.txt" name="readme.txt" />);

    const searchLabel = await screen.findByText("搜索文本");
    const jumpLabel = screen.getByText("跳转行号");
    expect(searchLabel).toBeVisible();
    expect(jumpLabel).toBeVisible();

    const searchInput = screen.getByRole("textbox", { name: "搜索文本" });
    const jumpInput = screen.getByRole("textbox", { name: "跳转行号" });
    await actor.type(searchInput, "beta");
    await actor.type(jumpInput, "2");
    await actor.click(screen.getByRole("button", { name: "跳转" }));

    expect(searchInput).toHaveValue("beta");
    expect(jumpInput).toHaveValue("2");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });
});
