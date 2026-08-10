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
        onOpenProviders={vi.fn()}
        onNewConv={vi.fn()}
        onOpenSidebar={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "配置 AI 提供商" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看对话" })).not.toBeInTheDocument();
  });
});
