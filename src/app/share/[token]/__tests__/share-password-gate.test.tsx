import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SharePasswordGate } from "../share-password-gate";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

describe("SharePasswordGate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([undefined, "DIRECTORY"])("authorizes password then opens the appropriate destination for %s", async (entryType) => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });

    render(
      <SharePasswordGate
        entryType={entryType}
        token="share-token-12345"
        label="需要密码"
        placeholder="••••••"
        submitLabel="下载文件"
        failedLabel="下载失败"
        failedStatusTemplate="下载失败（{status}）"
      />,
    );

    await user.type(screen.getByLabelText("需要密码"), "correct-password");
    await user.click(screen.getByRole("button", { name: "下载文件" }));

    expect(fetchMock).toHaveBeenCalledWith(`/api/share/share-token-12345${entryType ? "?archive=1" : ""}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "correct-password" }),
    });
    expect(assign).toHaveBeenCalledWith(entryType ? "/share/share-token-12345" : "/api/share/share-token-12345");
  });

  it("renders the localized failure fallback when the API rejects without a message", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });

    render(
      <SharePasswordGate
        token="share-token-12345"
        label="需要密码"
        placeholder="••••••"
        submitLabel="下载文件"
        failedLabel="下载失败"
        failedStatusTemplate="下载失败（{status}）"
      />,
    );

    await user.type(screen.getByLabelText("需要密码"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "下载文件" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("下载失败（429）");
    expect(assign).not.toHaveBeenCalled();
  });

  it("says it could not reach the server in the page's words, not the browser's", async () => {
    // A request that gets no answer throws the browser's own sentence ("Failed to fetch", "Load failed"),
    // and that is what the visitor of a Chinese share page read.
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });

    render(
      <SharePasswordGate
        token="share-token-12345"
        label="需要密码"
        placeholder="••••••"
        submitLabel="下载文件"
        failedLabel="下载失败"
        failedStatusTemplate="下载失败（{status}）"
        networkLabel="无法连接到服务器，请检查网络后重试"
      />,
    );
    await user.type(screen.getByLabelText("需要密码"), "correct-password");
    await user.click(screen.getByRole("button", { name: "下载文件" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("无法连接到服务器，请检查网络后重试");
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});
