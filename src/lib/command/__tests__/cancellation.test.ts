// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const findUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: { commandTarget: { findUnique } } }));
import { monitorCommandCancellation } from "../cancellation";

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
it("fails closed if the database becomes unavailable", async () => {
  findUnique.mockRejectedValue(new Error("database unavailable"));
  const controller = new AbortController();
  const stop = await monitorCommandCancellation("target", controller);
  expect(controller.signal.aborted).toBe(true);
  stop();
});

it("aborts a command when its cancellation lookup hangs", async () => {
  findUnique.mockImplementation(() => new Promise(() => undefined));
  const controller = new AbortController();
  const pending = monitorCommandCancellation("target", controller);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(controller.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  const stop = await pending;
  expect(controller.signal.aborted).toBe(true);
  stop();
});
