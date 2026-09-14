import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { TeamWorkspaceSection } from "../team-workspace-section";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: fetchMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("Team workspace member management", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      currentTeamId: "team-1",
      teams: [{
        id: "team-1", slug: "review", name: "Review team", description: "Original description",
        ownerId: "admin", createdAt: "2026-09-08",
        members: Array.from({ length: 12 }, (_, index) => ({
          role: "member", joinedAt: "2026-09-08",
          user: { id: `user-${index}`, username: `member-${index}`, displayName: null, status: "ACTIVE" },
        })),
      }],
    });
  });

  const renderTeam = () => renderWithI18n(<TeamWorkspaceSection capabilities={{ viewerId: "admin", canCreate: true, canManageMembers: true, canManageAll: true }} />, { locale: "en" });

  it("lets administrators reach members beyond the first ten", async () => {
    const user = userEvent.setup();
    renderTeam();
    await screen.findByText("member-9");
    expect(screen.queryByText("member-11")).not.toBeInTheDocument();
    const more = screen.getAllByRole("button").find((button) => /2.*member/i.test(button.textContent ?? ""));
    expect(more).toBeDefined();
    await user.click(more!);
    expect(screen.getByText("member-11")).toBeVisible();
  });

  it("cancels edits without saving and rejects an empty team name", async () => {
    const user = userEvent.setup();
    renderTeam();
    await screen.findByRole("heading", { name: "Review team" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const input = within(screen.getByRole("article")).getByRole("textbox", { name: "Team name" });
    await user.clear(input);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByDisplayValue("Original description")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Review team" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
