import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" || name === "test" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * A stored key that cannot be unlocked in-process is handed to ssh2 with its
 * passphrase. Fourteen call sites copied the connection field by field and
 * left the passphrase out, so storage-node listing, downloads, previews,
 * thumbnails, sync and health checks failed for such keys.
 */
describe("SSH credentials copied field by field", () => {
  it("carry the passphrase wherever they carry the private key", () => {
    const missing: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const match = /^\s*privateKey: ([A-Za-z]+)\.privateKey,\s*$/.exec(line);
        if (!match) return;
        const window = lines.slice(Math.max(0, index - 8), index + 8).join("\n");
        if (!window.includes(`${match[1]}.passphrase`)) missing.push(`${path.relative(ROOT, file)}:${index + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });
});
