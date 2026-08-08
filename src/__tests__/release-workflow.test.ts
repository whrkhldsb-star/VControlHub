import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("release workflow", () => {
  it("writes a portable checksum containing only the archive basename", async () => {
    const workflow = await readFile(
      path.resolve(process.cwd(), ".github/workflows/release.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      '(cd dist && sha256sum "vcontrolhub-${GITHUB_REF_NAME}.tar.gz" > "vcontrolhub-${GITHUB_REF_NAME}.tar.gz.sha256")',
    );
    expect(workflow).not.toContain(
      'sha256sum "dist/vcontrolhub-${GITHUB_REF_NAME}.tar.gz"',
    );
  });
});
