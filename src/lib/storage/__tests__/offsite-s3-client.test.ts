import { describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { S3Client, S3Error, randomProbeKey, uriEncodeKey, xmlText } from "../offsite/s3-client";

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

	it("putFile: streams the local file with a signed payload hash and content length", async () => {
		const dir = await mkdtemp("/tmp/vch-s3-stream-");
		const filePath = path.join(dir, "artifact.bin");
		const expected = Buffer.from("streamed-backup-content".repeat(1024));
		await writeFile(filePath, expected);
		let received = Buffer.alloc(0);
		let receivedHeaders: Record<string, string> = {};
		const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
			received = Buffer.from(await new Response(init?.body).arrayBuffer());
			receivedHeaders = Object.fromEntries(
				Object.entries(init?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]),
			);
			return new Response("", { status: 200, headers: { etag: '"stream-etag"' } });
		}) as unknown as typeof fetch;
		try {
			const client = new S3Client({ ...basicConfig(), fetchImpl });
			const result = await client.putFile("large/artifact.bin", filePath);
			expect(result.etag).toBe("stream-etag");
			expect(received).toEqual(expected);
			expect(receivedHeaders["content-length"]).toBe(String(expected.length));
			expect(receivedHeaders["x-amz-content-sha256"]).toMatch(/^[a-f0-9]{64}$/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
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

/**
 * SigV4 as the AWS documentation defines it, written independently of the
 * client: the canonical URI is each path segment UriEncoded once.
 */
function referenceSignature(call: { method: string; url: string; headers: Record<string, string> }, secret: string, region: string) {
	const url = new URL(call.url);
	const auth = call.headers["authorization"]!;
	const signed = /SignedHeaders=([^,]+)/.exec(auth)![1]!.split(";");
	const amzDate = call.headers["x-amz-date"]!;
	const day = amzDate.slice(0, 8);
	const value = (name: string) => (name === "host" ? url.host : (call.headers[name] ?? "").trim());
	const query = [...url.searchParams.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join("&");
	const canonical = [
		call.method,
		url.pathname,
		query,
		signed.map((name) => `${name}:${value(name)}\n`).join(""),
		signed.join(";"),
		call.headers["x-amz-content-sha256"],
	].join("\n");
	const scope = `${day}/${region}/s3/aws4_request`;
	const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
	const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
	const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), "s3"), "aws4_request");
	return createHmac("sha256", key).update(toSign).digest("hex");
}

describe("S3Client — object keys outside plain ASCII", () => {
	it("UriEncodes each key segment once (spaces, non-ASCII, ? and # included)", () => {
		expect(uriEncodeKey("dir one/中?#&+=.txt")).toBe("dir%20one/%E4%B8%AD%3F%23%26%2B%3D.txt");
		expect(uriEncodeKey("a/b/c-_.~(1)!*'.gz")).toBe("a/b/c-_.~%281%29%21%2A%27.gz");
	});

	it("sends the key in full and signs the path it sends", async () => {
		const { fetchImpl, calls } = makeFetchMock(() => new Response("", { status: 200, headers: { etag: '"e"' } }));
		const client = new S3Client({ ...basicConfig(), fetchImpl });
		await client.putObject("backups/报告 2026?v=1#a.tar.gz", "x");
		const call = calls[0]!;
		// "?" and "#" no longer cut the key off into a query/fragment.
		expect(new URL(call.url).search).toBe("");
		expect(new URL(call.url).hash).toBe("");
		expect(decodeURIComponent(new URL(call.url).pathname)).toBe("/my-bucket/backups/报告 2026?v=1#a.tar.gz");
		const signature = /Signature=([a-f0-9]{64})/.exec(call.headers["authorization"]!)![1];
		expect(signature).toBe(referenceSignature(call, "examplesecret", "us-east-1"));
	});

	it("lists keys with XML entities decoded, so they can be deleted as listed", async () => {
		const xml = `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>a&amp;b</NextContinuationToken>
<Contents><Key>old&amp;one &lt;1&gt; &#x4E2D;&#25991;.gz</Key><Size>1</Size><LastModified>x</LastModified><ETag>&quot;e1&quot;</ETag></Contents></ListBucketResult>`;
		const { fetchImpl } = makeFetchMock(() => new Response(xml, { status: 200 }));
		const client = new S3Client({ ...basicConfig(), fetchImpl });
		const out = await client.listObjects("");
		expect(out.objects[0]!.key).toBe("old&one <1> 中文.gz");
		expect(out.objects[0]!.etag).toBe("e1");
		expect(out.nextContinuationToken).toBe("a&b");
		expect(xmlText("&amp;lt; stays &amp;lt;")).toBe("&lt; stays &lt;");
	});
});

describe("S3Client — download deadline", () => {
	const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
	/** A body that delivers `chunks` pieces, `gapMs` apart. */
	const slowBody = (chunks: number, gapMs: number) => {
		let sent = 0;
		return new ReadableStream<Uint8Array>({
			async pull(controller) {
				await sleep(gapMs);
				if (sent >= chunks) controller.close();
				else { sent += 1; controller.enqueue(new Uint8Array([sent])); }
			},
		});
	};
	const drain = async (stream: ReadableStream<Uint8Array>) => {
		const reader = stream.getReader();
		let total = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return total;
			total += value.length;
		}
	};

	it("lets a download that keeps moving run past the budget (it used to be cut off after timeoutMs in all)", async () => {
		let signal: AbortSignal | undefined;
		const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
			signal = init.signal ?? undefined;
			return new Response(slowBody(6, 40), { status: 200, headers: { "content-length": "6" } });
		}) as unknown as typeof fetch;
		const client = new S3Client(basicConfig({ fetchImpl, timeoutMs: 120 }));
		const object = await client.getObject("backups/a.tar.gz");
		// 6 chunks 40 ms apart: ~250 ms in all, more than the 120 ms budget, but never silent for 120 ms.
		expect(await drain(object!.body)).toBe(6);
		expect(signal?.aborted).toBe(false);
	});

	it("still gives up on a download that goes silent", async () => {
		let signal: AbortSignal | undefined;
		const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
			signal = init.signal ?? undefined;
			return new Response(slowBody(3, 300), { status: 200 });
		}) as unknown as typeof fetch;
		const client = new S3Client(basicConfig({ fetchImpl, timeoutMs: 100 }));
		const object = await client.getObject("backups/a.tar.gz");
		const reading = drain(object!.body);
		await sleep(250);
		expect(signal?.aborted).toBe(true);
		void reading.catch(() => undefined);
		await object!.body.cancel().catch(() => undefined);
	});
});
