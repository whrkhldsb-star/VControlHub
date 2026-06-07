import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../provider";
import { DomI18nBridge } from "../dom-bridge";

function renderBridge(locale: "zh" | "en") {
  return render(
    <I18nProvider initialLocale={locale}>
      <DomI18nBridge />
      <main>
        <h1>备份与迁移</h1>
        <button aria-label="执行恢复" title="执行恢复">执行恢复</button>
        <nav data-i18n-skip>
          <a href="/notifications">通知中心</a>
        </nav>
        <input placeholder="确认文本" />
        <code>创建定时备份</code>
        <p>qa_canary_20260603.txt</p>
      </main>
    </I18nProvider>,
  );
}

describe("DomI18nBridge", () => {
  it("translates existing server-rendered text and attributes when initial locale is English", async () => {
    renderBridge("en");

    expect(await screen.findByRole("heading", { name: "Backups & Migration" })).toBeInTheDocument();
    const restoreButton = screen.getByRole("button", { name: "Run restore" });
    expect(restoreButton).toHaveAttribute("title", "Run restore");
    expect(screen.getByPlaceholderText("Confirmation text")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "通知中心" })).toBeInTheDocument();
    expect(screen.queryByText("Notifications中心")).not.toBeInTheDocument();
    expect(screen.getByText("创建定时备份")).toBeInTheDocument();
    expect(screen.getByText("qa_canary_20260603.txt")).toBeInTheDocument();
  });

  it("translates content inserted after hydration", async () => {
    renderBridge("en");

    act(() => {
      const node = document.createElement("p");
      node.textContent = "只有 COMPLETED 状态的备份可以执行恢复。";
      document.body.appendChild(node);
    });

    await waitFor(() => expect(screen.getByText("Only COMPLETED backups can be restored.")).toBeInTheDocument());
  });

  it("does not translate in Chinese mode", () => {
    renderBridge("zh");
    expect(screen.getByRole("heading", { name: "备份与迁移" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "执行恢复" })).toBeInTheDocument();
  });
});
