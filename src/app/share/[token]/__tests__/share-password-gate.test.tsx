import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SharePasswordGate } from "../share-password-gate";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

describe("SharePasswordGate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("authorizes the password with a small POST then lets the browser stream the GET", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });

    render(
      <SharePasswordGate
        token="share-token-12345"
        label="需要密码"
        placeholder="••••••"
        submitLabel="下载文件"
      />,
    );

    await user.type(screen.getByLabelText("需要密码"), "correct-password");
    await user.click(screen.getByRole("button", { name: "下载文件" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/share/share-token-12345", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "correct-password" }),
    });
    expect(assign).toHaveBeenCalledWith("/api/share/share-token-12345");
  });
});
