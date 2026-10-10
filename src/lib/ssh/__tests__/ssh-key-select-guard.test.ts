import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") sourceFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

describe("SSH key projections", () => {
  // A key imported before passphrase-free normalisation still has its
  // passphrase stored. Selecting only `privateKey` broke every feature except
  // the terminal for those keys, so every projection uses the shared select.
  it("never select a private key without its passphrase", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/sshKey:\s*\{\s*select:\s*\{([^}]*)\}/g)) {
        const body = match[1]!;
        if (/privateKey/.test(body) && !/passphrase|SSH_KEY_CREDENTIAL_SELECT/.test(body)) {
          offenders.push(`${relative(ROOT, file)}:${text.slice(0, match.index).split("\n").length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
