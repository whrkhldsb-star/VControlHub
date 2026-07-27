import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "@/components/status-badge";

describe("StatusBadge", () => {
  it("renders semantic tone and standard pill chrome", () => {
    render(<StatusBadge tone="success">Healthy</StatusBadge>);
    const badge = screen.getByText("Healthy");
    expect(badge).toHaveAttribute("data-status-badge");
    expect(badge).toHaveAttribute("data-tone", "emerald");
    expect(badge.className).toContain("text-[var(--success)]");
  });

  it("supports the larger list badge size", () => {
    render(<StatusBadge size="md">Active</StatusBadge>);
    expect(screen.getByText("Active").className).toContain("px-2.5");
  });
});
