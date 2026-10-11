import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";

const { requirePlatformAdminPageMock } = vi.hoisted(() => ({
  requirePlatformAdminPageMock: vi.fn(),
}));

vi.mock("@/lib/auth/page-guard", () => ({ requirePlatformAdminPage: requirePlatformAdminPageMock }));
vi.mock("../system-health-client", () => ({
  SystemHealthClient: ({
    initialSystemHealth,
  }: {
    initialSystemHealth?: { summary: { total: number } } | null;
  }) => (
    <div data-testid="system-health">
      <span data-testid="initial-system-health">
        {initialSystemHealth === null ? "null" : initialSystemHealth ? "report" : "missing"}
      </span>
    </div>
  ),
}));

import HealthPage from "../page";

describe("HealthPage (platform self-check)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlatformAdminPageMock.mockResolvedValue({ userId: "user_1", username: "root", roles: ["admin"] });
  });

  it("is platform-only: the guard's refusal reaches the error boundary", async () => {
    requirePlatformAdminPageMock.mockRejectedValueOnce(new ForbiddenError("platform only"));

    await expect(HealthPage()).rejects.toBeInstanceOf(ForbiddenError);
    expect(requirePlatformAdminPageMock).toHaveBeenCalledWith({ redirectTo: "/health" });
  });

  it("renders the system health client for platform administrators", async () => {
    render(await HealthPage());

    expect(screen.getByTestId("system-health")).toBeInTheDocument();
    expect(screen.getByTestId("initial-system-health")).toHaveTextContent("null");
  });
});
