// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";

const { lookup, send } = vi.hoisted(() => ({ lookup: vi.fn(), send: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));
vi.mock("undici", async (original) => ({ ...await original<typeof import("undici")>(), fetch: send }));
import { fetchPlaybookWebhook } from "../webhook-dispatch";

afterEach(() => vi.clearAllMocks());

it("ends the step at its deadline while DNS is pending and ignores its late answer", async () => {
  let finish!: (addresses: LookupAddress[]) => void;
  lookup.mockReturnValueOnce(new Promise<LookupAddress[]>((resolve) => { finish = resolve; }));
  const beforeSend = vi.fn();
  const result = fetchPlaybookWebhook("https://example.test", {
    method: "POST", headers: {}, signal: AbortSignal.timeout(20),
  }, beforeSend);
  await expect(result).resolves.toMatchObject({ ok: false, dispatched: false });
  finish([{ address: "93.184.216.34", family: 4 }]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(beforeSend).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("checks all resolved addresses before calling the transport", async () => {
  lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  const result = await fetchPlaybookWebhook("https://example.test", { method: "POST", headers: {}, signal: new AbortController().signal });
  expect(result).toMatchObject({ ok: false, dispatched: false });
  expect(send).not.toHaveBeenCalled();
});
