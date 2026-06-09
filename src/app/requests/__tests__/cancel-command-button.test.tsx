import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { CancelCommandButton } from "../cancel-command-button";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

describe("CancelCommandButton", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(csrfFetch).mockResolvedValue({ command: { id: "cmd1", status: "CANCELLED" } });
  });

  it("confirms cancellation through the command API and refreshes the server-rendered request list", async () => {
    render(<CancelCommandButton commandRequestId="cmd1" commandTitle="Restart nginx" />);

    await userEvent.click(screen.getByRole("button", { name: "取消命令：Restart nginx" }));
    expect(screen.getByRole("dialog", { name: "确认取消命令" })).toHaveTextContent("Restart nginx");

    await userEvent.type(screen.getByLabelText("取消原因（可选）"), "wrong maintenance window");
    await userEvent.click(screen.getByRole("button", { name: "确认取消" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/commands", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ action: "cancel", commandRequestId: "cmd1", reason: "wrong maintenance window" }),
    })));
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("命令取消请求已提交");
  });

  it("keeps the dialog open and surfaces API errors distinctly", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("当前命令请求已结束，无法取消"));
    render(<CancelCommandButton commandRequestId="cmd1" commandTitle="Restart nginx" />);

    await userEvent.click(screen.getByRole("button", { name: "取消命令：Restart nginx" }));
    await userEvent.click(screen.getByRole("button", { name: "确认取消" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("当前命令请求已结束，无法取消");
    expect(screen.getByRole("dialog", { name: "确认取消命令" })).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
