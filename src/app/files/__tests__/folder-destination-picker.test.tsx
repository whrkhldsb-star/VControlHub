import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { FolderDestinationPicker } from "../folder-destination-picker";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: fetchMock }));
const root = { folders: [{ path: "docs", relativePath: "docs", name: "Documents" }],
  pagination: { page: 1, pageSize: 50, totalItems: 51, totalPages: 2 } };

describe("FolderDestinationPicker", () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it("loads a scoped listing and selects the root explicitly", async () => {
    fetchMock.mockResolvedValue(root);
    const onSelect = vi.fn();
    renderWithI18n(<FolderDestinationPicker nodeId="node-1" onSelect={onSelect} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "选择目标文件夹" }));
    await screen.findByRole("button", { name: "Documents" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/files/list?nodeId=node-1&page=1&pageSize=50");
    fireEvent.click(screen.getByRole("button", { name: "选择此文件夹" }));
    expect(onSelect).toHaveBeenCalledWith(".");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("navigates down and back up without changing the storage node", async () => {
    fetchMock.mockResolvedValueOnce(root).mockResolvedValueOnce({ folders: [] }).mockResolvedValueOnce(root);
    renderWithI18n(<FolderDestinationPicker nodeId="node-1" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "选择目标文件夹" }));
    fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
    await screen.findByText("此页没有子文件夹");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("path=docs");
    fireEvent.click(screen.getByRole("button", { name: "返回上一层" }));
    await screen.findByRole("button", { name: "Documents" });
    expect(fetchMock.mock.calls[2]?.[0]).not.toContain("path=");
  });

  it("can retry a failed listing and never selects a stale destination", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(root);
    renderWithI18n(<FolderDestinationPicker nodeId="node-1" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "选择目标文件夹" }));
    await screen.findByText("offline");
    expect(screen.getByRole("button", { name: "选择此文件夹" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("button", { name: "Documents" });
    expect(screen.getByRole("button", { name: "选择此文件夹" })).toBeEnabled();
  });

  it("paginates folders without repeatedly syncing the remote node", async () => {
    fetchMock.mockResolvedValueOnce(root).mockResolvedValueOnce({ folders: [{ name: "Later folder", path: "later" }],
      pagination: { page: 2, pageSize: 50, totalItems: 51 } });
    renderWithI18n(<FolderDestinationPicker nodeId="node-1" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "选择目标文件夹" }));
    await screen.findByRole("button", { name: "Documents" });
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("button", { name: "Later folder" });
    expect(fetchMock.mock.calls[1]?.[0]).toContain("page=2");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("sync=0");
  });

  it("aborts loading when the picker closes", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderWithI18n(<FolderDestinationPicker nodeId="node-1" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "选择目标文件夹" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const signal = fetchMock.mock.calls[0]?.[1].signal as AbortSignal;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "取消" })); });
    expect(signal.aborted).toBe(true);
  });
});
