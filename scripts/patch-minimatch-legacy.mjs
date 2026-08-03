import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// ESLint's plugins still call minimatch 3 as a function. Keep that API working
// with brace-expansion 5 until those upstream packages drop minimatch 3.
const require = createRequire(import.meta.url);
const packagePath = require.resolve("minimatch/package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const braceExpansion = require("brace-expansion");

if (packageJson.version !== "3.1.5") {
  throw new Error(`Unsupported legacy minimatch version: ${packageJson.version}`);
}

if (typeof braceExpansion.expand !== "function") {
  throw new Error("brace-expansion 5.x does not expose the expected expand function");
}

if (packageJson.dependencies?.["brace-expansion"] !== "5.0.9") {
  packageJson.dependencies["brace-expansion"] = "5.0.9";
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

const sourcePath = join(dirname(packagePath), "minimatch.js");
const source = readFileSync(sourcePath, "utf8");
const original = "var expand = require('brace-expansion')";
const patched = [
  "var braceExpansion = require('brace-expansion')",
  "var expand = typeof braceExpansion === 'function' ? braceExpansion : braceExpansion.expand",
].join("\n");

if (source.includes(patched)) process.exit(0);
if (!source.includes(original)) {
  throw new Error("Legacy minimatch compatibility patch anchor was not found");
}

writeFileSync(sourcePath, source.replace(original, patched), "utf8");
