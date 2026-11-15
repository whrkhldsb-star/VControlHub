// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const findUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: { commandTarget: { findUnique } } }));
import { CommandCancellationStateUnknownError, monitorCommandCancellation } from "../cancellation";

beforeEach(() => { vi.useFakeTimers(); findUnique.mockReset(); });
afterEach(() => vi.useRealTimers());
it("observes a durable cancellation after dispatch and releases its timer", async () => {
  findUnique.mockResolvedValue({ status: "RUNNING", commandRequest: { status: "RUNNING" } });
  const controller = new AbortController();
  const stop = await monitorCommandCancellation("target", controller);
  expect(controller.signal.aborted).toBe(false);
  findUnique.mockResolvedValue({ status: "RUNNING", commandRequest: { status: "CANCELLING" } });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(controller.signal.aborted).toBe(true);
  stop();
  const calls = findUnique.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5_000);
  expect(findUnique).toHaveBeenCalledTimes(calls);
});
it("fails closed if the database stays unavailable", async () => {
  findUnique.mockRejectedValue(new Error("database unavailable"));
  const controller = new AbortController();
  const stop = await monitorCommandCancellation("target", controller);
  // Three failed lookups in a row, one a second.
  expect(controller.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(controller.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(controller.signal.aborted).toBe(true);
  expect(controller.signal.reason).toBeInstanceOf(CommandCancellationStateUnknownError);
  stop();
});

it("keeps the command running through a failed lookup that the next one answers", async () => {
  // One failed or slow lookup stopped every running command while the remote processes kept going.
  findUnique.mockRejectedValueOnce(new Error("lock timeout"))
    .mockRejectedValueOnce(new Error("lock timeout"))
    .mockResolvedValue({ status: "RUNNING", commandRequest: { status: "RUNNING" } });
  const controller = new AbortController();
  const stop = await monitorCommandCancellation("target", controller);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(controller.signal.aborted).toBe(false);
  // The count starts again after an answer.
  findUnique.mockRejectedValueOnce(new Error("lock timeout")).mockRejectedValueOnce(new Error("lock timeout"));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(controller.signal.aborted).toBe(false);
  stop();
});

it("aborts a command when its cancellation lookups keep hanging", async () => {
  findUnique.mockImplementation(() => new Promise(() => undefined));
  const controller = new AbortController();
  const pending = monitorCommandCancellation("target", controller);
  // Each lookup gives up after 5 s; the third in a row stops the command.
  await vi.advanceTimersByTimeAsync(5_000);
  const stop = await pending;
  expect(controller.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(6_000);
  expect(controller.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(6_000);
  expect(controller.signal.aborted).toBe(true);
  stop();
});
