import { Readable } from "node:stream";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

vi.mock("@/lib/storage/file-content", () => ({ streamStorageFile: vi.fn() }));
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/share-link/service", () => ({
	authorizeShareDownload: vi.fn(),
	assertShareTargetNotDeleted: vi.fn(async () => undefined),
	hashShareToken: vi.fn((token: string) => `hash:${token}`),
	normalizeSharePath: vi.fn((value: string) => value.replace(/^\/+/, "")),
	releaseShareQuotaClaim: vi.fn(async () => undefined),
  resolveShareToken: vi.fn(),
}));

const { authorizeShareDownload, resolveShareToken } = await import("@/lib/share-link/service");
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

  it("delivers an anonymous WebDAV share inline without exposing credentials", async () => {
    const { streamStorageFile } = await import("@/lib/storage/file-content");
    vi.mocked(streamStorageFile).mockResolvedValueOnce({ stream: Readable.from("dav text"), size: 8, close: vi.fn() } as never);
    vi.mocked(resolveShareToken).mockResolvedValueOnce({
      id: "dav_share", storageNodeId: "dav_node",
      storageNode: { id: "dav_node", driver: "WEBDAV", basePath: "/", webdavConfigEncrypted: "secret-cipher" },
      entryType: "FILE", path: "hello.txt", name: "hello.txt",
    } as never);
    const response = await route.GET(new Request("http://local/api/share/dav?inline=1"), { params: Promise.resolve({ token: "dav-public-token-12345" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^inline/);
    expect(await response.text()).toBe("dav text");
    expect([...response.headers.values()].join(" ")).not.toContain("secret-cipher");
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

  it.each<[string, string]>([['hello.txt', 'inline'], ['attack.html', 'attachment'], ['attack.svg', 'attachment']])("restricts inline content for %s", async (name: string, disposition: string) => {
    await writeFile(path.join(tempRoot, name), '<script>alert(1)</script>');
    vi.mocked(resolveShareToken).mockResolvedValueOnce({
      storageNode: { id: 'node_1', driver: 'LOCAL', basePath: tempRoot },
      entryType: 'FILE', path: name, name,
    } as never);
    const response = await route.GET(new Request('http://local/api/share/token?inline=1'), {
      params: Promise.resolve({ token: 'share-token-12345' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(new RegExp(`^${disposition}`));
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    await response.text();
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
      last = await route.GET(new Request(`http://local/api/share/token`, { headers: { "cf-connecting-ip": "203.0.113.45", "x-share-password": `bad${i}` } }), {
        params: Promise.resolve({ token: "share-token-rate-limit" }),
      });
    }

    expect(last?.status).toBe(429);
  });

	it("exchanges a password for a short-lived HttpOnly download credential", async () => {
		vi.mocked(authorizeShareDownload).mockResolvedValueOnce({ id: "share-password" } as never);
		const token = "share-token-password";

		const authorizeResponse = await route.POST(new Request(`https://local/api/share/${token}`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
			body: JSON.stringify({ password: "correct-password" }),
		}), {
			params: Promise.resolve({ token }),
		});

		expect(authorizeResponse.status).toBe(200);
		expect(authorizeShareDownload).toHaveBeenCalledWith(token, "correct-password", expect.any(Object));
		const cookie = authorizeResponse.headers.getSetCookie().find((value) => value.includes("share_download_ticket="));
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Path=/;");
		expect(cookie).toContain("Secure");

		vi.mocked(resolveShareToken).mockResolvedValueOnce({
			id: "share-password",
			storageNode: { id: "node_1", name: "本机存储", driver: "LOCAL", basePath: tempRoot },
			entryType: "FILE",
			path: "missing.txt",
			name: "missing.txt",
		} as never);
		await route.GET(new Request(`https://local/api/share/${token}`, { headers: { cookie: cookie! } }), {
			params: Promise.resolve({ token }),
		});
		expect(resolveShareToken).toHaveBeenCalledWith(
			token,
			undefined,
			expect.any(Object),
			{ authorizedShareId: "share-password" },
		);
	});

});
