import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeleteConfirmButton } from "../delete-confirm-button";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

const deleteActionMock = vi.hoisted(() =>
  vi.fn(async (_prev: unknown, formData: FormData) => ({
    success: `已删除 ${formData.get("fileEntryId")}`,
  })),
);

vi.mock("../../storage/actions", () => ({
  deleteFileEntryAction: deleteActionMock,
}));

describe("DeleteConfirmButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("confirms deletion through the shared modal and refreshes via the callback", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onNotify = vi.fn();
    // No window.location.reload spy: jsdom forbids redefining it, and a real
    // reload call would surface as a jsdom navigation error and fail the test.

    render(
      <DeleteConfirmButton
        fileEntryId="file_1"
        entryName="cover.jpg"
        entryType="FILE"
        onRefresh={onRefresh}
        onNotify={onNotify}
      />,
    );

    await user.click(screen.getByRole("button", { name: "删除 cover.jpg" }));

    // Shared ConfirmDialog (modal) instead of the former inline state swap.
    expect(
      await screen.findByRole("button", { name: "确认" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(onNotify).toHaveBeenCalledWith("success", "已删除 file_1");
    expect(deleteActionMock).toHaveBeenCalledTimes(1);
  });

  it("cancels without submitting the action", async () => {
    const user = userEvent.setup();

    render(
      <DeleteConfirmButton
        fileEntryId="file_1"
        entryName="cover.jpg"
        entryType="FILE"
      />,
    );

    await user.click(screen.getByRole("button", { name: "删除 cover.jpg" }));
    await user.click(await screen.findByRole("button", { name: "取消" }));

    expect(deleteActionMock).not.toHaveBeenCalled();
  });
});
