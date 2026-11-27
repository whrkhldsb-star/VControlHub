import { expect, it, vi } from "vitest";
import { getLockKeys } from "@/lib/concurrency/advisory-lock";
import { lockDownloadPublication } from "../publication-lock";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/config/env", () => ({ config: { db: { url: "postgresql://localhost/test" } } }));
vi.mock("pg", async load => ({ ...await load<typeof import("pg")>(), Client: class { on() {} async connect() {} query = query; async end() {} } }));

it("locks the lower-case file exclusively and its parents including the node root shared", async () => {
  const unlock = await lockDownloadPublication("node", "Docs/File");
  for (const [id, shared] of [["node:", true], ["node:docs", true], ["node:docs/file", false]] as const) {
    const { k1, k2 } = getLockKeys("storage-editable", id);
    expect(query).toHaveBeenCalledWith(`SELECT pg_advisory_lock${shared ? "_shared" : ""}($1, $2)`, [k1, k2]);
  }
  await unlock();
});
