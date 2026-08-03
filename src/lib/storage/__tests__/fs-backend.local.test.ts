import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createManagedFolder } from "../fs-backend";

describe("createManagedFolder LOCAL filesystem", () => {
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it("creates a folder when the configured storage root does not exist yet", async () => {
    temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "vcontrolhub-storage-"),
    );
    const basePath = path.join(temporaryDirectory, "missing-root");
    const relativePath = "first-folder";

    await createManagedFolder({
      storageNode: { driver: "LOCAL", basePath },
      relativePath,
    });

    expect((await stat(path.join(basePath, relativePath))).isDirectory()).toBe(
      true,
    );
    await expect(
      createManagedFolder({
        storageNode: { driver: "LOCAL", basePath },
        relativePath,
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
  });
});
