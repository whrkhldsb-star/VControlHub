import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const copies = Object.entries(lock.packages ?? {})
  .filter(([path]) => path.endsWith("node_modules/brace-expansion"))
  .map(([path, metadata]) => ({ path, version: metadata.version }));

if (copies.length === 0) {
  throw new Error("No brace-expansion package was found in package-lock.json");
}

for (const copy of copies) {
  if (copy.version !== "5.0.8") {
    throw new Error(`Unsafe brace-expansion resolved at ${copy.path}: ${copy.version}`);
  }
}

const lockText = JSON.stringify(lock);
if (lockText.includes("minimatch-legacy-compat")) {
  throw new Error("package-lock.json contains a stale local minimatch compatibility link");
}

const minimatchLock = lock.packages?.["node_modules/minimatch"];
if (minimatchLock?.version !== "3.1.5") {
  throw new Error(`Expected minimatch 3.1.5 at the dependency root, found ${minimatchLock?.version ?? "none"}`);
}

const minimatchPackagePath = require.resolve("minimatch/package.json");
const installedMinimatch = JSON.parse(readFileSync(minimatchPackagePath, "utf8"));
if (installedMinimatch.version !== "3.1.5") {
  throw new Error(`Unexpected installed minimatch version: ${installedMinimatch.version}`);
}
if (installedMinimatch.dependencies?.["brace-expansion"] !== "5.0.8") {
  throw new Error("The installed minimatch package metadata lacks the brace-expansion 5 compatibility patch");
}

const minimatchSource = readFileSync(resolve(dirname(minimatchPackagePath), "minimatch.js"), "utf8");
if (!minimatchSource.includes("braceExpansion.expand")) {
  throw new Error("The installed minimatch source lacks the brace-expansion 5 compatibility patch");
}

const modulePath = dirname(minimatchPackagePath);
const probe = spawnSync(
  process.execPath,
  [
    "--max-old-space-size=96",
    "-e",
    `const minimatch = require(process.argv[1]);
if (typeof minimatch !== "function" || typeof minimatch.Minimatch !== "function") process.exit(2);
if (!minimatch("src/app.ts", "src/**/*.{ts,tsx}")) process.exit(3);
if (!new minimatch.Minimatch("**/*.js").match("scripts/check.js")) process.exit(4);
const result = minimatch.braceExpand("{a,b}".repeat(1500));
const total = result.reduce((sum, value) => sum + value.length, 0);
if (result.length === 0 || total > 4_000_000) process.exit(5);
process.stdout.write(JSON.stringify({ results: result.length, total }));`,
    modulePath,
  ],
  { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 },
);

if (probe.status !== 0) {
  throw new Error(
    `minimatch/brace-expansion security probe failed (status=${probe.status}, signal=${probe.signal ?? "none"}): ${probe.stderr}`,
  );
}

const result = JSON.parse(probe.stdout);
console.log(
  `toolchain-security-ok braceExpansion=${copies[0].version} copies=${copies.length} minimatch=${installedMinimatch.version} results=${result.results} totalCharacters=${result.total}`,
);
