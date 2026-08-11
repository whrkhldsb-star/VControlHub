import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecycleBinSectionClient } from "../recycle-bin-section-client";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("../restore-button", () => ({
  RestoreButton: ({ onRefresh }: { onRefresh?: () => void }) => (
    <button type="button" onClick={onRefresh}>Restore fixture</button>
  ),
}));

vi.mock("../permanent-delete-button", () => ({
  PermanentDeleteButton: ({ onRefresh }: { onRefresh?: () => void }) => (
    <button type="button" onClick={onRefresh}>Delete fixture</button>
  ),
}));

describe("RecycleBinSectionClient", () => {
  beforeEach(() => refresh.mockClear());

  it.each(["Restore fixture", "Delete fixture"])(
    "removes a completed entry immediately after %s",
    (actionName) => {
      render(
        <RecycleBinSectionClient
          canDelete
          deletedEntries={[
            { id: "entry-1", name: "obsolete.txt", entryType: "FILE", relativePath: "obsolete.txt", size: 12 },
          ]}
        />,
      );

      fireEvent.click(screen.getAllByRole("button", { name: actionName })[0]!);

      expect(screen.queryByText("obsolete.txt")).not.toBeInTheDocument();
      expect(refresh).toHaveBeenCalledOnce();
    },
  );
});
