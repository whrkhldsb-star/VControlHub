// @vitest-environment node
import { expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  prime: vi.fn(), startLocale: vi.fn(), start: vi.fn(), stop: vi.fn(async () => {}),
  close: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
}));
vi.mock("@/lib/settings/prime", () => ({ primeSettingCaches: io.prime }));
vi.mock("@/lib/i18n/background-locale", () => ({ startBackgroundCopyLocaleSync: io.startLocale }));
vi.mock("@/lib/workers/startup", () => ({ startWorkerLifecycle: io.start, stopWorkerLifecycle: io.stop }));
vi.mock("@/lib/ssh/client", () => ({ closeSshPool: io.close }));
vi.mock("@/lib/db", () => ({ prisma: { $disconnect: io.disconnect } }));
vi.mock("@/lib/logging", () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

it("honors the first SIGTERM during startup cache priming and finishes teardown", async () => {
  let warmed!: () => void;
  io.prime.mockImplementationOnce(() => new Promise<void>(resolve => { warmed = resolve; }));
  const events = ["SIGTERM", "SIGINT", "unhandledRejection"] as const;
  const original = new Set<unknown>(events.flatMap(event => process.listeners(event)));
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  try {
    await import("../../../worker");
    expect(io.prime).toHaveBeenCalledOnce();
    const onTerm = process.listeners("SIGTERM").find(listener => !original.has(listener));
    expect(onTerm).toBeDefined();
    onTerm!("SIGTERM");
    warmed();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
    expect(io.startLocale).not.toHaveBeenCalled();
    expect(io.start).not.toHaveBeenCalled();
    expect(io.stop).toHaveBeenCalledOnce();
    expect(io.close).toHaveBeenCalledOnce();
    expect(io.disconnect).toHaveBeenCalledOnce();
  } finally {
    for (const event of events) {
      for (const listener of process.listeners(event)) {
        if (!original.has(listener)) process.removeListener(event, listener);
      }
    }
    exit.mockRestore();
  }
});
