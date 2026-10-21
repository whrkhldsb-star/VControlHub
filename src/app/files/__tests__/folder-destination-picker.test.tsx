import { useState } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { FolderBrowser } from "../folder-destination-picker";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: fetchMock }));
const root = { folders: [{ path: "docs", relativePath: "docs", name: "Documents" }],
  pagination: { page: 1, pageSize: 50, totalItems: 51, totalPages: 2 } };

function Harness({ onReady, disabled }: { onReady?: (ready: boolean) => void; disabled?: Set<string> }) {
  const [path, setPath] = useState("");
  return (
    <>
      <FolderBrowser nodeId="node-1" nodeName="Local" path={path} onPathChange={setPath} onReadyChange={onReady} disabledPaths={disabled} />
      <output data-testid="path">{path}</output>
    </>
  );
}

describe("FolderBrowser", () => {
  beforeEach(() => { fetchMock.mockReset(); });

  it("loads a scoped listing and reports when the folder on screen can be chosen", async () => {
    fetchMock.mockResolvedValue(root);
    const onReady = vi.fn();
    renderWithI18n(<Harness onReady={onReady} />);
    await screen.findByRole("button", { name: "Documents" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/files/list?nodeId=node-1&page=1&pageSize=50");
    // Readiness is reported from an effect after that render.
    await waitFor(() => expect(onReady).toHaveBeenLastCalledWith(true));
  });

  it("navigates down and back up without changing the storage node", async () => {
    fetchMock.mockResolvedValueOnce(root).mockResolvedValueOnce({ folders: [] }).mockResolvedValueOnce(root);
    renderWithI18n(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
    await screen.findByText("此页没有子文件夹");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("path=docs");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("nodeId=node-1");
    expect(screen.getByTestId("path")).toHaveTextContent("docs");
    fireEvent.click(screen.getByRole("button", { name: "返回上一层" }));
    await screen.findByRole("button", { name: "Documents" });
    expect(fetchMock.mock.calls[2]?.[0]).not.toContain("path=");
  });

  it("can retry a failed listing and is not ready while it fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(root);
    const onReady = vi.fn();
    renderWithI18n(<Harness onReady={onReady} />);
    await screen.findByText("offline");
    expect(onReady).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("button", { name: "Documents" });
    // Readiness is reported from an effect after that render.
    await waitFor(() => expect(onReady).toHaveBeenLastCalledWith(true));
  });

  it("paginates folders without repeatedly syncing the remote node", async () => {
    fetchMock.mockResolvedValueOnce(root).mockResolvedValueOnce({ folders: [{ name: "Later folder", path: "later" }],
      pagination: { page: 2, pageSize: 50, totalItems: 51 } });
    renderWithI18n(<Harness />);
    await screen.findByRole("button", { name: "Documents" });
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("button", { name: "Later folder" });
    expect(fetchMock.mock.calls[1]?.[0]).toContain("page=2");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("sync=0");
  });

  it("disables folders that cannot be a destination", async () => {
    fetchMock.mockResolvedValue(root);
    renderWithI18n(<Harness disabled={new Set(["docs"])} />);
    expect(await screen.findByRole("button", { name: "Documents" })).toBeDisabled();
  });

  it("aborts loading when the browser unmounts", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderWithI18n(<Harness />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const signal = fetchMock.mock.calls[0]?.[1].signal as AbortSignal;
    await act(async () => { unmount(); });
    expect(signal.aborted).toBe(true);
  });
});
