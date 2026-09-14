import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { JobEventsDialog } from "../job-events-dialog";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

function deferred() {
  let resolve!: (value: { events: ReturnType<typeof row>[] }) => void;
  const promise = new Promise<{ events: ReturnType<typeof row>[] }>((done) => { resolve = done; });
  return { promise, resolve };
}
function row(id: string) {
  return { id, jobId: id, type: "progress", level: "info", message: `message-${id}`, workerId: null, payload: null, createdAt: "2026-09-08T00:00:00Z" };
}

describe("job event request ownership", () => {
  it("ignores late responses after switching tasks and aborts the old request", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(csrfFetch).mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onClose = vi.fn();
    const { rerender } = renderWithI18n(<JobEventsDialog open jobId="first" onClose={onClose} />);
    const firstSignal = vi.mocked(csrfFetch).mock.calls[0]?.[1]?.signal;
    rerender(<JobEventsDialog open jobId="second" onClose={onClose} />);
    await act(async () => second.resolve({ events: [row("second")] }));
    await act(async () => first.resolve({ events: [row("first")] }));
    expect(screen.getByText("message-second")).toBeInTheDocument();
    expect(screen.queryByText("message-first")).not.toBeInTheDocument();
    expect(firstSignal?.aborted).toBe(true);
  });

  it("clears the previous task while loading and aborts on unmount", async () => {
    const pending = deferred();
    vi.mocked(csrfFetch).mockReset().mockResolvedValueOnce({ events: [row("first")] }).mockReturnValueOnce(pending.promise);
    const onClose = vi.fn();
    const { rerender, unmount } = renderWithI18n(<JobEventsDialog open jobId="first" onClose={onClose} />);
    await screen.findByText("message-first");
    rerender(<JobEventsDialog open jobId="second" onClose={onClose} />);
    expect(screen.queryByText("message-first")).not.toBeInTheDocument();
    const signal = vi.mocked(csrfFetch).mock.calls[1]?.[1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve({ events: [row("second")] }));
  });
});
