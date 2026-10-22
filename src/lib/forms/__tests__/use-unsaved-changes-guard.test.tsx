import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { useUnsavedChangesGuard } from "../use-unsaved-changes-guard";
import { requestNavigation } from "../navigation-request";

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
  // Unmounting a dirty form steps back over its extra history entry; in
  // jsdom that popstate would arrive during the next test.
  beforeEach(() => {
    vi.spyOn(window.history, "back").mockImplementation(() => undefined);
  });

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

  it("asks before a keyboard shortcut or search result leaves the page", async () => {
    // They called router.push directly; only link clicks were guarded.
    const user = userEvent.setup();
    const navigate = vi.fn();
    push.mockClear();
    render(<Harness dirty />);

    act(() => requestNavigation("/files", navigate));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("当前内容尚未保存");
    await user.click(screen.getByRole("button", { name: "放弃并离开" }));
    expect(push).toHaveBeenCalledWith("/files");
  });

  it("lets programmatic navigation through when nothing is unsaved", () => {
    const navigate = vi.fn();
    render(<Harness dirty={false} />);
    requestNavigation("/files", navigate);
    expect(navigate).toHaveBeenCalledWith("/files");
  });

  it("answers the browser's Back with the same question", async () => {
    const user = userEvent.setup();
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    window.history.replaceState(null, "", window.location.href);
    const start = window.history.length;
    render(<Harness dirty />);
    // An entry for this page sits on top while there are unsaved changes.
    expect(window.history.length).toBe(start + 1);
    expect(window.history.state).toMatchObject({ __vchUnsavedGuard: true });

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("当前内容尚未保存");
    await user.click(screen.getByRole("button", { name: "放弃并离开" }));
    expect(go).toHaveBeenCalledWith(-2);
    go.mockRestore();
  });
});
