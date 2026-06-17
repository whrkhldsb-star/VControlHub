import { describe, expect, it, vi } from "vitest";

import { S3Client, S3Error, randomProbeKey } from "../offsite/s3-client";

function makeFetchMock(handler: (req: { method: string; url: string; body: Buffer | null; headers: Record<string, string> }) => Response | Promise<Response>) {
	const calls: Array<{ method: string; url: string; body: Buffer | null; headers: Record<string, string> }> = [];
	const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
		const headers: Record<string, string> = {};
		for (const [k, v] of Object.entries(init.headers ?? {})) {
			headers[k.toLowerCase()] = String(v);
		}
		const body = init.body == null
			? null
			: typeof init.body === "string"
				? Buffer.from(init.body, "utf8")
				: Buffer.from(init.body as ArrayBuffer);
		const entry = { method: String(init.method ?? "GET").toUpperCase(), url, body, headers };
		calls.push(entry);
		return handler(entry);
	});
	// Cast: vi.fn type signature (url: string) doesn't structurally match
	// globalThis.fetch (RequestInfo | URL); the runtime behaviour is identical
	// for our tests, so an explicit cast is clearer than @ts-expect-error.
	return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function basicConfig(
	overrides: Partial<{
		endpoint: string;
		region: string;
		bucket: string;
		accessKeyId: string;
		secretAccessKey: string;
		pathStyle: boolean;
		fetchImpl: typeof fetch;
		timeoutMs: number;
	}> = {},
) {
	return {
		endpoint: "https://s3.example.com",
		region: "us-east-1",
		bucket: "my-bucket",
		accessKeyId: "AKIAEXAMPLE",
		secretAccessKey: "examplesecret",
		...overrides,
	};
}

describe("S3Client — construction", () => {
	it("rejects empty accessKeyId", () => {
		expect(() => new S3Client(basicConfig({ accessKeyId: "" }))).toThrow(S3Error);
	});

	it("rejects empty bucket", () => {
		expect(() => new S3Client(basicConfig({ bucket: "" }))).toThrow(S3Error);
	});

	it("rejects empty region", () => {
		expect(() => new S3Client(basicConfig({ region: "" }))).toThrow(S3Error);
	});

	it("rejects empty secretAccessKey", () => {
		expect(() => new S3Client(basicConfig({ secretAccessKey: "" }))).toThrow(S3Error);
	});

	it("rejects empty endpoint", () => {
		expect(() => new S3Client(basicConfig({ endpoint: "" }))).toThrow(S3Error);
	});
});

describe("S3Client — path style + signing", () => {
	it("uses path-style URL by default for non-AWS endpoints and signs the request", async () => {
		const { fetchImpl, calls } = makeFetchMock(() =>
			new Response("", { status: 200, headers: { etag: '"abc123"' } }),
		);
		const client = new S3Client({ ...basicConfig({ endpoint: "https://minio.local" }), fetchImpl });
		const result = await client.putObject("backups/2026-06-17/file.tar.gz", "hello");
		expect(result.etag).toBe("abc123");
		expect(calls).toHaveLength(1);
		const call = calls[0]!;
		expect(call.method).toBe("PUT");
		expect(call.url).toBe("https://minio.local/my-bucket/backups/2026-06-17/file.tar.gz");
		expect(call.headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date(;x-amz-[a-z0-9-]+)*, Signature=[a-f0-9]{64}$/);
		expect(call.headers["x-amz-content-sha256"]).toMatch(/^[a-f0-9]{64}$/);
		expect(call.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
	});

	it("uses virtual-hosted style for AWS endpoints unless pathStyle=true", async () => {
		const { fetchImpl, calls } = makeFetchMock(() => new Response("", { status: 200, headers: { etag: '"x"' } }));
		const client = new S3Client({ ...basicConfig({ endpoint: "https://s3.us-east-1.amazonaws.com" }), fetchImpl });
		await client.putObject("k", "v");
		expect(calls[0]!.url).toBe("https://my-bucket.s3.us-east-1.amazonaws.com/k");
	});

	it("honours pathStyle=true override even on AWS-style endpoints", async () => {
		const { fetchImpl, calls } = makeFetchMock(() => new Response("", { status: 200, headers: { etag: '"x"' } }));
		const client = new S3Client({ ...basicConfig({ endpoint: "https://s3.us-east-1.amazonaws.com", pathStyle: true }), fetchImpl });
		await client.putObject("k", "v");
		expect(calls[0]!.url).toBe("https://s3.us-east-1.amazonaws.com/my-bucket/k");
	});
});

describe("S3Client — operations", () => {
	it("putObject: returns etag stripped of quotes and includes server-side encryption header", async () => {
		const { fetchImpl, calls } = makeFetchMock(() => new Response("", { status: 200, headers: { etag: '"deadbeef"' } }));
		const client = new S3Client({ ...basicConfig(), fetchImpl });
		const out = await client.putObject("k", "body");
		expect(out.etag).toBe("deadbeef");
		expect(calls[0]!.headers["x-amz-server-side-encryption"]).toBe("AES256");
	});

	it("headObject: returns metadata on 200, null on 404", async () => {
		const head200 = makeFetchMock(() => new Response("", {
			status: 200,
			headers: { etag: '"x"', "content-length": "42", "content-type": "text/plain", "last-modified": "Wed, 17 Jun 2026 00:00:00 GMT" },
		}));
		const c1 = new S3Client({ ...basicConfig(), fetchImpl: head200.fetchImpl });
		const meta = await c1.headObject("k");
		expect(meta?.size).toBe(42);
		expect(meta?.contentType).toBe("text/plain");

		const head404 = makeFetchMock(() => new Response("", { status: 404 }));
		const c2 = new S3Client({ ...basicConfig(), fetchImpl: head404.fetchImpl });
		expect(await c2.headObject("missing")).toBeNull();
	});

	it("deleteObject: no-op on 204/404, errors on 500", async () => {
		// undici rejects `Response("", { status: 204 })` per HTTP spec (204 must not have body);
		// use `Response(null, ...)` to model real S3 204 responses.
		const ok = makeFetchMock(() => new Response(null, { status: 204 }));
		const c1 = new S3Client({ ...basicConfig(), fetchImpl: ok.fetchImpl });
		await expect(c1.deleteObject("k")).resolves.toBeUndefined();

		const notFound = makeFetchMock(() => new Response("", { status: 404 }));
		const c2 = new S3Client({ ...basicConfig(), fetchImpl: notFound.fetchImpl });
		await expect(c2.deleteObject("k")).resolves.toBeUndefined();

		const err = makeFetchMock(() => new Response("<Error><Code>InternalError</Code><Message>boom</Message></Error>", { status: 500 }));
		const c3 = new S3Client({ ...basicConfig(), fetchImpl: err.fetchImpl });
		await expect(c3.deleteObject("k")).rejects.toThrow(S3Error);
	});

	it("listObjects: parses XML response with prefix and continuation token", async () => {
		const xml = `<?xml version="1.0"?>
<ListBucketResult>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>tok123</NextContinuationToken>
  <Contents>
    <Key>backups/a.tar.gz</Key>
    <Size>100</Size>
    <LastModified>2026-06-17T00:00:00.000Z</LastModified>
    <ETag>"aaa"</ETag>
  </Contents>
  <Contents>
    <Key>backups/b.tar.gz</Key>
    <Size>200</Size>
    <LastModified>2026-06-17T00:01:00.000Z</LastModified>
    <ETag>"bbb"</ETag>
  </Contents>
</ListBucketResult>`;
		const { fetchImpl, calls } = makeFetchMock(() => new Response(xml, { status: 200 }));
		const client = new S3Client({ ...basicConfig(), fetchImpl });
		const out = await client.listObjects("backups/", 1000, "prev-token");
		expect(out.isTruncated).toBe(true);
		expect(out.nextContinuationToken).toBe("tok123");
		expect(out.objects).toEqual([
			{ key: "backups/a.tar.gz", size: 100, lastModified: "2026-06-17T00:00:00.000Z", etag: "aaa" },
			{ key: "backups/b.tar.gz", size: 200, lastModified: "2026-06-17T00:01:00.000Z", etag: "bbb" },
		]);
		const call = calls[0]!;
		expect(call.method).toBe("GET");
		expect(call.url).toContain("list-type=2");
		expect(call.url).toContain("prefix=backups%2F");
		expect(call.url).toContain("continuation-token=prev-token");
	});

	it("throws S3Error with parsed code on failure", async () => {
		const { fetchImpl } = makeFetchMock(() => new Response(
			"<Error><Code>NoSuchBucket</Code><Message>The bucket does not exist</Message></Error>",
			{ status: 404, headers: { "x-amz-request-id": "REQ-1" } },
		));
		const client = new S3Client({ ...basicConfig(), fetchImpl });
		try {
			await client.putObject("k", "v");
			throw new Error("expected to throw");
		} catch (err) {
			expect(err).toBeInstanceOf(S3Error);
			const e = err as S3Error;
			expect(e.code).toBe("NoSuchBucket");
			expect(e.status).toBe(404);
			expect(e.requestId).toBe("REQ-1");
			expect(e.message).toContain("bucket does not exist");
		}
	});
});

describe("randomProbeKey", () => {
	it("returns a key with the given prefix", () => {
		const k = randomProbeKey("_probe/");
		expect(k.startsWith("_probe/")).toBe(true);
		expect(k.endsWith(".probe")).toBe(true);
	});

	it("returns unique values across calls", () => {
		const a = randomProbeKey();
		const b = randomProbeKey();
		expect(a).not.toBe(b);
	});
});
