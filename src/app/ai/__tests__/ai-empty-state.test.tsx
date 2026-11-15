import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

import { AiEmptyState } from "../ai-empty-state";

describe("AiEmptyState", () => {
  it("keeps the conversation list reachable when no conversation is active", async () => {
    const user = userEvent.setup();
    const onOpenSidebar = vi.fn();

    render(
      <AiEmptyState
        hasProviders
        sidebarShown={false}
        onOpenProviders={vi.fn()}
        onNewConv={vi.fn()}
        onOpenSidebar={onOpenSidebar}
      />,
    );

    await user.click(screen.getByRole("button", { name: "查看对话" }));
    expect(onOpenSidebar).toHaveBeenCalledOnce();
  });

  it("shows provider setup when no provider exists", () => {
    render(
      <AiEmptyState
        hasProviders={false}
        sidebarShown={false}
        onOpenProviders={vi.fn()}
        onNewConv={vi.fn()}
        onOpenSidebar={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "配置 AI 提供商" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看对话" })).not.toBeInTheDocument();
  });

  it("is headed by the page's name, and what is missing is said under it", () => {
    render(
      <AiEmptyState
        hasProviders={false}
        sidebarShown={false}
        onOpenProviders={vi.fn()}
        onNewConv={vi.fn()}
        onOpenSidebar={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AI 助手");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("还没有可用的 AI 提供商");
  });

  it("leaves the page's name to the open sidebar's title", () => {
    render(
      <AiEmptyState
        hasProviders
        sidebarShown
        onOpenProviders={vi.fn()}
        onNewConv={vi.fn()}
        onOpenSidebar={vi.fn()}
      />,
    );

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("选择一个对话或创建新对话");
  });
});
