import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePreferenceButton } from "../file-preferences-client";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const star = () => screen.getByRole("button", { name: "收藏与标签" }).querySelector("svg")!;

describe("file preference star", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("shows what the list knows before its dialog is opened (I1-2)", () => {
    // Every row of the favorites list showed an empty star.
    renderWithI18n(<FilePreferenceButton fileEntryId="entry_1" favorite />);
    expect(star()).toHaveAttribute("fill", "currentColor");
  });

  it("keeps the saved state on the star when a change is cancelled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ items: [{ fileEntryId: "entry_1", favorite: true, tags: [] }], nextCursor: null }), { status: 200, headers: { "content-type": "application/json" } }));
    renderWithI18n(<FilePreferenceButton fileEntryId="entry_1" favorite />);
    fireEvent.click(screen.getByRole("button", { name: "收藏与标签" }));
    const checkbox = await screen.findByRole("checkbox", { name: "收藏" });
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(star()).toHaveAttribute("fill", "currentColor");
  });
});
