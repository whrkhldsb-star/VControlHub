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
    vi.clearAllMocks();
  });

  it("requires diff review confirmation before saving edited file content", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ draft: { content: "alpha\nbeta\n", file: { byteSize: 11 } } })
      .mockResolvedValueOnce({ success: true, file: { byteSize: 17, previousByteSize: 11 } });

    render(<TextPreviewClient href="/download/readme.txt" name="readme.txt" fileEntryId="file_1" editable />);

    expect(await screen.findByText("可在线编辑")).toBeInTheDocument();
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
      body: JSON.stringify({ content: "alpha\ngamma\ndelta\n" }),
    })));
    expect(await screen.findByRole("status")).toHaveTextContent("已保存 17 B");
    expect(screen.queryByRole("dialog", { name: "保存前差异预览" })).not.toBeInTheDocument();
  });
});
