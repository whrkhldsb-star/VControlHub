import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { AiSidebar } from "../ai-sidebar";
import type { ConvItem } from "../ai-types";

const conversation = {
  id: "conv-1",
  title: "生产排障助手",
} as ConvItem;

function renderSidebar(matchesMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: matchesMobile }),
  });
  const onSelectConv = vi.fn();
  const onToggleSidebar = vi.fn();
  render(
    <AiSidebar
      showSidebar
      conversations={[conversation]}
      activeConvId={null}
      onNewConv={vi.fn()}
      onSelectConv={onSelectConv}
      onDeleteConv={vi.fn()}
      onToggleSidebar={onToggleSidebar}
      onToggleProviders={vi.fn()}
    />,
  );
  return { onSelectConv, onToggleSidebar };
}

describe("AiSidebar", () => {
  it("closes the conversation drawer after selecting a conversation on mobile", async () => {
    const user = userEvent.setup();
    const { onSelectConv, onToggleSidebar } = renderSidebar(true);

    await user.click(screen.getByText("生产排障助手"));

    expect(onSelectConv).toHaveBeenCalledWith("conv-1");
    expect(onToggleSidebar).toHaveBeenCalledWith(false);
  });

  it("keeps the conversation sidebar open after selection on desktop", async () => {
    const user = userEvent.setup();
    const { onSelectConv, onToggleSidebar } = renderSidebar(false);

    await user.click(screen.getByText("生产排障助手"));

    expect(onSelectConv).toHaveBeenCalledWith("conv-1");
    expect(onToggleSidebar).not.toHaveBeenCalled();
  });
});
