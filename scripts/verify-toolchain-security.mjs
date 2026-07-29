import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const copies = Object.entries(lock.packages ?? {})
  .filter(([path]) => path.endsWith("node_modules/brace-expansion"))
  .map(([path, metadata]) => ({ path, version: metadata.version }));
const allowedVersions = new Set(["1.1.17", "5.0.8"]);

if (copies.length === 0) {
  throw new Error("No brace-expansion package was found in package-lock.json");
}

for (const copy of copies) {
  if (!allowedVersions.has(copy.version)) {
    throw new Error(`Unsafe or unreviewed brace-expansion resolved at ${copy.path}: ${copy.version}`);
  }
}

const legacyCopies = copies.filter(({ version }) => version?.startsWith("1."));
for (const copy of legacyCopies) {
  const packageDir = resolve(root, dirname(copy.path), "brace-expansion");
  const source = readFileSync(resolve(packageDir, "index.js"), "utf8");
  if (!source.includes("EXPANSION_MAX_LENGTH") || !source.includes("CVE-2026-14257")) {
    throw new Error(`brace-expansion at ${copy.path} lacks the CVE-2026-14257 bounds`);
  }
}

const representative = legacyCopies[0];
if (!representative) {
  throw new Error("Expected the ESLint/minimatch 3 compatibility branch to be installed");
}

const modulePath = resolve(root, dirname(representative.path), "brace-expansion");
const probe = spawnSync(
  process.execPath,
  [
    "--max-old-space-size=96",
    "-e",
    `const expand = require(process.argv[1]);
const result = expand("{a,b}".repeat(1500));
const total = result.reduce((sum, value) => sum + value.length, 0);
if (result.length === 0 || total > 4_000_000) process.exit(2);
process.stdout.write(JSON.stringify({ results: result.length, total }));`,
    modulePath,
  ],
  { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 },
);

if (probe.status !== 0) {
  throw new Error(
    `brace-expansion CVE probe failed (status=${probe.status}, signal=${probe.signal ?? "none"}): ${probe.stderr}`,
  );
}

const result = JSON.parse(probe.stdout);
console.log(
  `toolchain-security-ok copies=${copies.length} legacy=${legacyCopies.length} results=${result.results} totalCharacters=${result.total}`,
);
