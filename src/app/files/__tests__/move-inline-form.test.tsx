import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { MoveFileActionState } from "../move-file-action";

const mocks = vi.hoisted(() => ({ state: {} as MoveFileActionState, action: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useActionState: () => [mocks.state, mocks.action, false],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../move-file-action", () => ({ moveFileAction: vi.fn() }));
import { MoveInlineForm } from "../move-inline-form";

beforeEach(() => { mocks.state = {}; mocks.action.mockReset(); });

it.each([false, true])("allows another submission only when the result is confirmed (uncertain=%s)", (uncertain) => {
  mocks.state = { error: "Inspect source and destination", ...(uncertain ? { needsReconcile: true } : {}) };
  render(<MoveInlineForm fileEntryId="file" name="a.txt" relativePath="source/a.txt" />);
  fireEvent.click(screen.getByRole("button", { name: "filesPage.actions.moveAria" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "destination" } });
  const confirm = screen.getByRole("button", { name: "common.confirm" });
  if (uncertain) {
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Inspect source and destination");
  } else {
    expect(confirm).toBeEnabled();
  }
});
