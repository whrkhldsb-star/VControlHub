// @vitest-environment node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Entrypoint smoke for `npm run load:baseline`: a k6 shim records the script
 * path it was handed and never opens a connection. This verifies the wrapper,
 * not any capacity figure.
 */
describe.skipIf(process.platform === "win32")("scripts/load/run-k6-baseline.sh", () => {
  let bin: string;
  beforeEach(() => {
    bin = mkdtempSync(path.join(tmpdir(), "vch-k6-shim-"));
    const shim = path.join(bin, "k6");
    writeFileSync(shim, '#!/bin/sh\nfor last; do :; done\nprintf "%s\\n" "$last"\n[ -f "$last" ]\n');
    chmodSync(shim, 0o755);
  });
  afterEach(() => rmSync(bin, { recursive: true, force: true }));

  it("hands k6 the baseline script that exists in the repository", () => {
    const result = spawnSync("bash", ["scripts/load/run-k6-baseline.sh"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, BASE_URL: "http://127.0.0.1:9" },
    });
    const scriptPath = result.stdout.trim().split("\n").at(-1);
    expect(scriptPath).toBe(path.resolve("scripts/load/k6-baseline.js"));
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
