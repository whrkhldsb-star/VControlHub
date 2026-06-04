import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/share-link/service", () => ({
  resolveShareToken: vi.fn(),
}));

const { resolveShareToken } = await import("@/lib/share-link/service");
const route = await import("../route");

describe("share token file route", () => {
  let tempRoot: string;
  let previousSlug: string | undefined;

  beforeEach(async () => {
    previousSlug = process.env.APP_SLUG;
    process.env.APP_SLUG = "vcontrolhub";
    tempRoot = await mkdtemp(path.join(tmpdir(), "share-route-expanded-"));
  });

  afterEach(async () => {
    if (previousSlug === undefined) {
      delete process.env.APP_SLUG;
    } else {
      process.env.APP_SLUG = previousSlug;
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("resolves LOCAL share links against expanded app slug storage roots", async () => {
    const expandedRoot = path.join(tempRoot, "vcontrolhub", "storage");
    await mkdir(path.join(expandedRoot, "docs"), { recursive: true });
    const absolutePath = path.join(expandedRoot, "docs", "hello.txt");
    await writeFile(absolutePath, "hello share");

    vi.mocked(resolveShareToken).mockResolvedValueOnce({
      storageNode: {
        id: "node_1",
        name: "本机存储",
        driver: "LOCAL",
        basePath: path.join(tempRoot, "${APP_SLUG:-vcontrolhub}", "storage"),
      },
      path: "docs/hello.txt",
      name: "hello.txt",
    } as never);

    const response = await route.GET(new Request("http://local/api/share/token"), {
      params: Promise.resolve({ token: "share-token-12345" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("hello.txt");
    await expect(response.text()).resolves.toBe("hello share");
  });
});
