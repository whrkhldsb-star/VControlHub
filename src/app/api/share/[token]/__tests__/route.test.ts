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
      entryType: "FILE",
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

  it("streams LOCAL directory shares as tar.gz archives", async () => {
    const expandedRoot = path.join(tempRoot, "vcontrolhub", "storage");
    await mkdir(path.join(expandedRoot, "docs"), { recursive: true });
    await writeFile(path.join(expandedRoot, "docs", "hello.txt"), "hello archive");

    vi.mocked(resolveShareToken).mockResolvedValueOnce({
      storageNode: {
        id: "node_1",
        name: "本机存储",
        driver: "LOCAL",
        basePath: path.join(tempRoot, "${APP_SLUG:-vcontrolhub}", "storage"),
      },
      entryType: "DIRECTORY",
      path: "docs",
      name: "资料 目录",
    } as never);

    const response = await route.GET(new Request("http://local/api/share/token?archive=1"), {
      params: Promise.resolve({ token: "share-token-12345" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/gzip");
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(response.headers.get("content-disposition")).toContain("%E8%B5%84%E6%96%99-%E7%9B%AE%E5%BD%95.tar.gz");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 2)]).toEqual([0x1f, 0x8b]);
  });
  it("rate limits repeated password attempts for a share token", async () => {
    vi.mocked(resolveShareToken).mockRejectedValue(new Error("密码错误"));

    let last: Response | null = null;
    for (let i = 0; i < 9; i++) {
      last = await route.GET(new Request(`http://local/api/share/token?password=bad${i}`, { headers: { "cf-connecting-ip": "203.0.113.45" } }), {
        params: Promise.resolve({ token: "share-token-rate-limit" }),
      });
    }

    expect(last?.status).toBe(429);
  });

});
