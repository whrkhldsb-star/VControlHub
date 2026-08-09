import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { useUnsavedChangesGuard } from "../use-unsaved-changes-guard";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function Harness({ dirty, onDiscard, onAction }: { dirty: boolean; onDiscard?: () => void; onAction?: () => void }) {
  const { requestAction, requestDiscard, discardDialog } = useUnsavedChangesGuard({ dirty, onDiscard });
  return (
    <>
      <a href="/next">Next</a>
      <button type="button" onClick={requestDiscard}>Close</button>
      <button type="button" onClick={() => requestAction(() => onAction?.())}>Switch</button>
      {discardDialog}
    </>
  );
}

describe("useUnsavedChangesGuard", () => {
  it("intercepts internal navigation until the user confirms", async () => {
    const user = userEvent.setup();
    render(<Harness dirty />);

    await user.click(screen.getByRole("link", { name: "Next" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("当前内容尚未保存");
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "放弃并离开" }));
    expect(push).toHaveBeenCalledWith("/next");
  });

  it("confirms a dirty modal close and closes a clean modal immediately", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    const view = render(<Harness dirty onDiscard={onDiscard} />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onDiscard).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "放弃并离开" }));
    expect(onDiscard).toHaveBeenCalledOnce();

    view.rerender(<Harness dirty={false} onDiscard={onDiscard} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onDiscard).toHaveBeenCalledTimes(2);
  });

  it("defers non-link actions until dirty changes are discarded", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<Harness dirty onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Switch" }));
    expect(onAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "放弃并离开" }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});
