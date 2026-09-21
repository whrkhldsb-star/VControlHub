#!/usr/bin/env node
/**
 * Cross-platform wrapper for deploy/verify-assets.sh (Linux deploy asset
 * validation). On Windows the bash entrypoints under validation are not
 * runnable, so the step degrades to an explicit skip instead of breaking
 * `npm run verify`.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  console.log("verify:deploy-assets: skipped on Windows (Linux deployment assets are validated on Linux CI)");
  process.exit(0);
}

const result = spawnSync("bash", [resolve(root, "deploy", "verify-assets.sh")], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
