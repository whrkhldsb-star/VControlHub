import { readFileSync } from "node:fs";

// This check runs before npm installs dependencies.
const [major, minor, patch] = process.versions.node.split(".").map(Number);
const supported = (major === 22 && (minor > 22 || (minor === 22 && patch >= 2)))
  || (major === 24 && minor >= 15) || major >= 26;
if (!supported) {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.error("VControlHub requires Node.js " + manifest.engines.node + ", found " + process.versions.node);
  process.exitCode = 1;
}
