import { expect, it, vi } from "vitest";
import { getLockKeys } from "@/lib/concurrency/advisory-lock";
import { lockDownloadPublication } from "../publication-lock";

const { query, handlers } = vi.hoisted(() => ({
  query: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => void>(),
}));
vi.mock("@/lib/config/env", () => ({ config: { db: { url: "postgresql://localhost/test" } } }));
vi.mock("pg", async load => ({
  ...await load<typeof import("pg")>(),
  Client: class {
    on(event: string, listener: (...args: unknown[]) => void) { handlers.set(event, listener); }
    async connect() {}
    query = query;
    async end() { handlers.get("end")?.(); }
  },
}));

it("locks the lower-case file exclusively and its parents including the node root shared", async () => {
  handlers.clear();
  const unlock = await lockDownloadPublication("node", "Docs/File");
  for (const [id, shared] of [["node:", true], ["node:docs", true], ["node:docs/file", false]] as const) {
    const { k1, k2 } = getLockKeys("storage-editable", id);
    expect(query).toHaveBeenCalledWith(`SELECT pg_advisory_lock${shared ? "_shared" : ""}($1, $2)`, [k1, k2]);
  }
  expect(unlock.signal.aborted).toBe(false);
  expect(() => unlock.assertHeld()).not.toThrow();
  await unlock();
  // Normal release must not flag a lost-lock error.
  expect(unlock.signal.aborted).toBe(false);
});

it("signals lock loss and throws from assertHeld when the session drops unexpectedly", async () => {
  handlers.clear();
  const unlock = await lockDownloadPublication("node", "Docs/File");
  handlers.get("end")?.();
  expect(unlock.signal.aborted).toBe(true);
  expect(() => unlock.assertHeld()).toThrow(/Publication lock connection lost/);
  await unlock();
});
