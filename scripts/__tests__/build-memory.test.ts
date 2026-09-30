// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";

const directory = mkdtempSync(path.join(tmpdir(), "vch-build-memory-"));
const entry = path.join(directory, "child.cjs");
const wrapper = path.resolve(import.meta.dirname, "../run-with-build-memory.mjs");
writeFileSync(entry, "console.log(JSON.stringify({ options: process.env.NODE_OPTIONS, args: process.argv.slice(2) })); process.exit(Number(process.env.FIXTURE_EXIT_CODE || 0));");
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it("passes the default heap budget into an actual build child", () => {
  const child = spawnSync(process.execPath, [wrapper, entry, "fixture-argument"], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", VCONTROLHUB_BUILD_HEAP_MB: "4096" } });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({ options: "--max-old-space-size=4096", args: ["fixture-argument"] });
});
it("preserves an operator's explicit heap option and the child's failure code", () => {
  const child = spawnSync(process.execPath, [wrapper, entry], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=1536", VCONTROLHUB_BUILD_HEAP_MB: "1024", FIXTURE_EXIT_CODE: "7" } });
  expect(child.status).toBe(7);
  expect(JSON.parse(child.stdout).options).toBe("--max-old-space-size=1536");
});
it("rejects an invalid heap budget before invoking the build tool", () => {
  const child = spawnSync(process.execPath, [wrapper, entry], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", VCONTROLHUB_BUILD_HEAP_MB: "-1" } });
  expect(child.status).not.toBe(0);
  expect(child.stdout).toBe("");
  expect(child.stderr).toContain("VCONTROLHUB_BUILD_HEAP_MB");
});
